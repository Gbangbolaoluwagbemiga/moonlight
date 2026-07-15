// Fast-sync bootstrap for FRESH wallets on long-running networks.
//
// A brand-new wallet owns nothing in chain history, yet the wallet SDK
// replays every historical ledger event (~1.3M on Preprod) just to build
// the zswap/dust commitment Merkle trees — at the indexer's throttled
// ~10 events/s that is a multi-day sync. Instead we ask the indexer for
// *collapsed Merkle tree updates* (the same mechanism Lace uses), apply
// them to empty local states, and hand the wallet SDK pre-built state
// snapshots via its own restore() entry points.
//
// ONLY sound for wallets with no prior shielded/dust activity: collapsing
// the whole tree discards any coins the wallet might have owned.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { WebSocket } from 'ws';
import { type Config } from './config';

interface EventStreamHead {
  maxId: number;
}

/** Read the current highest event id of a ledger-event subscription. */
const fetchMaxId = (wsUrl: string, subscriptionField: string): Promise<EventStreamHead> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws');
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out reading ${subscriptionField} head`));
    }, 30_000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init' })));
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === 'connection_ack') {
        ws.send(
          JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: { query: `subscription { ${subscriptionField}(id: 0) { id maxId } }` },
          }),
        );
      } else if (msg.type === 'next') {
        clearTimeout(timer);
        ws.close();
        resolve({ maxId: msg.payload.data[subscriptionField].maxId });
      } else if (msg.type === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`${subscriptionField} subscription error: ${JSON.stringify(msg.payload).slice(0, 200)}`));
      }
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gql = async (httpUrl: string, query: string): Promise<any> => {
  let lastError: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });
      return await res.json();
    } catch (e) {
      lastError = e;
      await sleep(1_000 * (i + 1));
    }
  }
  throw lastError;
};

const withRetries = async <T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await sleep(2_000 * (i + 1));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastError).slice(0, 200)}`);
};

/** Largest end index for which `queryFor(end)` succeeds, or -1 if none (empty tree). */
const findMaxEndIndex = async (httpUrl: string, queryField: string): Promise<number> => {
  const ok = async (end: number): Promise<boolean> => {
    const r = await gql(httpUrl, `{ ${queryField}(startIndex: 0, endIndex: ${end}) { endIndex } }`);
    return !r.errors;
  };
  if (!(await ok(0))) return -1;
  // exponential probe then binary search
  let lo = 0;
  let hi = 1;
  while (await ok(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 2 ** 31) break;
  }
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
};

const fetchCollapsedUpdate = async (httpUrl: string, queryField: string, end: number): Promise<Uint8Array> => {
  const r = await gql(httpUrl, `{ ${queryField}(startIndex: 0, endIndex: ${end}) { update } }`);
  if (r.errors) throw new Error(`${queryField}(0, ${end}) failed: ${JSON.stringify(r.errors).slice(0, 300)}`);
  return Buffer.from(r.data[queryField].update, 'hex');
};

export interface FastSyncSnapshots {
  shieldedSnapshot: string;
  dustSnapshot: string;
}

interface RawEvent {
  id: number;
  raw: string;
}

/** Collect events with id > fromId until the stream reaches upToId (or goes quiet). */
const fetchEvents = (wsUrl: string, subscriptionField: string, fromId: number, upToId: number): Promise<RawEvent[]> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws');
    const events: RawEvent[] = [];
    let quietTimer: NodeJS.Timeout;
    const finish = () => {
      clearTimeout(quietTimer);
      ws.close();
      resolve(events.sort((a, b) => a.id - b.id));
    };
    const resetQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, 20_000);
    };
    resetQuiet();
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init' })));
    ws.on('error', (e) => {
      clearTimeout(quietTimer);
      reject(e);
    });
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === 'connection_ack') {
        ws.send(
          JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: { query: `subscription { ${subscriptionField}(id: ${fromId}) { id raw maxId } }` },
          }),
        );
      } else if (msg.type === 'next') {
        const ev = msg.payload?.data?.[subscriptionField];
        if (ev?.raw) events.push({ id: ev.id, raw: ev.raw });
        resetQuiet();
        if (ev && ev.id >= upToId) finish();
      } else if (msg.type === 'error') {
        clearTimeout(quietTimer);
        ws.close();
        reject(new Error(`${subscriptionField} error: ${JSON.stringify(msg.payload).slice(0, 200)}`));
      }
    });
  });

const NONLINEAR_RE = /expected to insert index (\d+), but received (\d+)/;

/**
 * Build a dust wallet state whose collapsed trees align exactly with the
 * event stream at `fromId`, then replay `events` on top of it. The ledger's
 * "non-linear insertion" errors report the tree head it expected, so tree
 * sizes are discovered iteratively from the errors themselves.
 */
const buildAlignedDustState = async (
  httpUrl: string,
  dustSecretKey: ledger.DustSecretKey,
  events: RawEvent[],
  initialCommitmentEnd: number,
  initialGenerationEnd: number,
  log: (msg: string) => void,
): Promise<ledger.DustLocalState> => {
  let commitmentEnd = initialCommitmentEnd;
  let generationEnd = initialGenerationEnd;

  for (let iter = 1; iter <= 8; iter++) {
    let state = new ledger.DustLocalState(ledger.LedgerParameters.initialParameters().dust);
    if (commitmentEnd >= 0) {
      const raw = await fetchCollapsedUpdate(httpUrl, 'dustCommitmentMerkleTreeUpdate', commitmentEnd);
      state = state.applyCommitmentCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(raw));
    }
    if (generationEnd >= 0) {
      const raw = await fetchCollapsedUpdate(httpUrl, 'dustGenerationMerkleTreeUpdate', generationEnd);
      state = state.applyGenerationCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(raw));
    }

    let realigned = false;
    for (const ev of events) {
      try {
        state = state.replayRawEvents(dustSecretKey, Buffer.from(ev.raw, 'hex')).state;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const m = msg.match(NONLINEAR_RE);
        if (!m) throw e;
        // The stream inserts at `received`; the collapsed tree must end
        // exactly at `received - 1` for the replay window to apply cleanly
        // (this realigns in BOTH directions — a too-large tree would
        // otherwise silently swallow our own registration events).
        const received = Number(m[2]);
        const isGeneration = msg.includes('generation');
        if (isGeneration) generationEnd = received - 1;
        else commitmentEnd = received - 1;
        log(
          `  Aligning dust ${isGeneration ? 'generation' : 'commitment'} tree to ${received} leaves (iteration ${iter})`,
        );
        realigned = true;
        break;
      }
    }
    if (!realigned) return state;
  }
  throw new Error('Could not align dust trees with the event stream after 8 iterations');
};

/**
 * Build restore() snapshots for the shielded and dust wallets, fast-forwarded
 * to the current chain tip. Retries until a snapshot is race-free (no new
 * ledger events arrive while the collapsed updates are being fetched).
 */
export const buildFastSyncSnapshots = async (
  config: Config,
  shieldedSecretKeys: ledger.ZswapSecretKeys,
  dustSecretKey: ledger.DustSecretKey,
  networkId: string,
  log: (msg: string) => void = console.log,
): Promise<FastSyncSnapshots> => {
  const httpUrl = config.indexer;
  const wsUrl = config.indexerWS;

  for (let attempt = 1; attempt <= 5; attempt++) {
    log(`  Fast-sync bootstrap attempt ${attempt}: reading chain tip...`);
    const [zswapHead, dustHead] = await Promise.all([
      withRetries('read zswap tip', () => fetchMaxId(wsUrl, 'zswapLedgerEvents')),
      withRetries('read dust tip', () => fetchMaxId(wsUrl, 'dustLedgerEvents')),
    ]);

    log(`  Chain tip: zswap event ${zswapHead.maxId}, dust event ${dustHead.maxId}. Locating tree sizes...`);
    const [zswapEnd, dustCommitmentEnd, dustGenerationEnd] = await Promise.all([
      findMaxEndIndex(httpUrl, 'zswapMerkleTreeCollapsedUpdate'),
      findMaxEndIndex(httpUrl, 'dustCommitmentMerkleTreeUpdate'),
      findMaxEndIndex(httpUrl, 'dustGenerationMerkleTreeUpdate'),
    ]);
    log(
      `  Tree sizes: zswap=${zswapEnd + 1}, dustCommitments=${dustCommitmentEnd + 1}, dustGenerations=${dustGenerationEnd + 1}`,
    );

    let zswapState = new ledger.ZswapLocalState();
    if (zswapEnd >= 0) {
      const raw = await fetchCollapsedUpdate(httpUrl, 'zswapMerkleTreeCollapsedUpdate', zswapEnd);
      zswapState = zswapState.applyCollapsedUpdate(ledger.MerkleTreeCollapsedUpdate.deserialize(raw));
    }

    // Dust: rewind well behind the tip so the wallet's OWN registration /
    // dust events (if any happened recently) are replayed and visible, then
    // iteratively align the collapsed trees with the event stream. The
    // rewind window must cover any prior activity of this wallet.
    const DUST_REWIND = 800;
    const dustFrom = Math.max(0, dustHead.maxId - DUST_REWIND);
    log(`  Replaying dust events ${dustFrom}..${dustHead.maxId} over collapsed trees...`);
    const dustEvents = await withRetries('fetch dust replay window', () =>
      fetchEvents(wsUrl, 'dustLedgerEvents', dustFrom, dustHead.maxId),
    );
    log(`  Fetched ${dustEvents.length} dust events for local replay. Aligning trees...`);
    const dustState = await buildAlignedDustState(
      httpUrl,
      dustSecretKey,
      dustEvents,
      dustCommitmentEnd,
      dustGenerationEnd,
      log,
    );
    const dustOffset = dustEvents.length > 0 ? dustEvents[dustEvents.length - 1].id : dustFrom;
    const dustBalance = dustState.walletBalance(new Date());
    log(`  Dust state ready: offset=${dustOffset}, walletBalance=${dustBalance}`);

    // Race check for the zswap tree (its offset rewind + the overlap-tolerant
    // replay patch absorb small inconsistencies).
    const zswapHead2 = await withRetries('re-read zswap tip', () => fetchMaxId(wsUrl, 'zswapLedgerEvents'));
    if (zswapHead2.maxId !== zswapHead.maxId) {
      log('  Chain advanced during snapshot, retrying for a race-free capture...');
      continue;
    }

    const ZSWAP_REWIND = 500;
    const shieldedSnapshot = JSON.stringify({
      publicKeys: {
        coinPublicKey: shieldedSecretKeys.coinPublicKey,
        encryptionPublicKey: shieldedSecretKeys.encryptionPublicKey,
      },
      state: Buffer.from(zswapState.serialize()).toString('hex'),
      protocolVersion: '0',
      offset: String(Math.max(0, zswapHead.maxId - ZSWAP_REWIND)),
      networkId,
      coinHashes: {},
    });

    const dustSnapshot = JSON.stringify({
      publicKey: { publicKey: String(dustSecretKey.publicKey) },
      state: Buffer.from(dustState.serialize()).toString('hex'),
      protocolVersion: '0',
      networkId,
      offset: String(dustOffset),
    });

    log('  Fast-sync snapshots built successfully.');
    return { shieldedSnapshot, dustSnapshot };
  }

  throw new Error('Could not capture a race-free fast-sync snapshot after 5 attempts');
};
