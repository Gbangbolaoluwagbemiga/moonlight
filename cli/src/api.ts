// Oru CLI — contract deployment and interaction API.
//
// Wallet/provider plumbing adapted from midnightntwrk/example-counter
// (Apache-2.0, Copyright (C) Midnight Foundation), including its documented
// workarounds for wallet SDK signing bugs. Contract-specific logic
// (work orders, commitments, identity derivation) is Oru's own.

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHash, randomBytes } from 'node:crypto';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Oru, type OruPrivateState, createOruPrivateState, witnesses } from '@oru/contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  type OruCircuits,
  type OruProviders,
  type DeployedOruContract,
  OruPrivateStateId,
} from './common-types';
import { type Config, contractConfig } from './config';
import { buildFastSyncSnapshots, type FastSyncSnapshots } from './fast-sync';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

let logger: Logger;

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// Pre-compile the Oru contract with its witnesses and ZK circuit assets
const oruCompiledContract = CompiledContract.make('oru', Oru.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// ─── Oru helpers ──────────────────────────────────────────────────────

/** Hash arbitrary job details (title/description) into a 32-byte commitment. */
export const hashDetails = (details: string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(details, 'utf8').digest());

/** A random 32-byte salt for the budget commitment. */
export const randomSalt = (): Uint8Array => new Uint8Array(randomBytes(32));

/**
 * Derive the Oru marketplace secret key deterministically from the
 * wallet seed, so a user's marketplace identity is recoverable from the same
 * seed as their funds — while remaining unlinkable on-chain (only its hash,
 * further hashed in-circuit, ever appears).
 */
export const deriveOruSecretKey = (walletSeedHex: string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(`oru:sk:${walletSeedHex}`, 'utf8').digest());

export const ORDER_STATUS_NAMES: Record<number, string> = {
  [Oru.OrderStatus.OPEN]: 'OPEN',
  [Oru.OrderStatus.ASSIGNED]: 'ASSIGNED',
  [Oru.OrderStatus.COMPLETED]: 'COMPLETED',
  [Oru.OrderStatus.CANCELLED]: 'CANCELLED',
};

export const getOruLedgerState = async (
  providers: OruProviders,
  contractAddress: ContractAddress,
): Promise<Oru.Ledger | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? Oru.ledger(contractState.data) : null;
};

// ─── Contract operations ────────────────────────────────────────────────────

export const deploy = async (
  providers: OruProviders,
  privateState: OruPrivateState,
): Promise<DeployedOruContract> => {
  logger.info('Deploying Oru contract...');
  const contract = await deployContract(providers, {
    compiledContract: oruCompiledContract,
    privateStateId: OruPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const joinContract = async (
  providers: OruProviders,
  contractAddress: string,
  privateState: OruPrivateState,
): Promise<DeployedOruContract> => {
  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: oruCompiledContract,
    privateStateId: OruPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export interface PostedOrder {
  orderId: bigint;
  budgetSalt: Uint8Array;
  txId: string;
  blockHeight: number;
}

/**
 * Post a work order. The details string and budget never leave this machine;
 * only their commitments are sent to the chain. Returns the order id and the
 * budget salt — the salt must be saved to later prove the budget amount.
 */
export const postOrder = async (
  contract: DeployedOruContract,
  details: string,
  budget: bigint,
): Promise<PostedOrder> => {
  const budgetSalt = randomSalt();
  const finalized = await contract.callTx.postOrder(hashDetails(details), budget, budgetSalt);
  return {
    orderId: finalized.private.result,
    budgetSalt,
    txId: finalized.public.txId,
    blockHeight: finalized.public.blockHeight,
  };
};

export const acceptOrder = async (contract: DeployedOruContract, orderId: bigint) => {
  const finalized = await contract.callTx.acceptOrder(orderId);
  return finalized.public;
};

export const completeOrder = async (contract: DeployedOruContract, orderId: bigint) => {
  const finalized = await contract.callTx.completeOrder(orderId);
  return finalized.public;
};

export const cancelOrder = async (contract: DeployedOruContract, orderId: bigint) => {
  const finalized = await contract.callTx.cancelOrder(orderId);
  return finalized.public;
};

export const verifyBudget = async (
  contract: DeployedOruContract,
  orderId: bigint,
  budget: bigint,
  salt: Uint8Array,
): Promise<boolean> => {
  const finalized = await contract.callTx.verifyBudget(orderId, budget, salt);
  return finalized.private.result;
};

/** Print the public order book: statuses and commitments only, never plaintext. */
export const displayOrders = async (
  providers: OruProviders,
  contract: DeployedOruContract,
): Promise<void> => {
  const contractAddress = contract.deployTxData.public.contractAddress;
  const state = await getOruLedgerState(providers, contractAddress);
  if (state === null) {
    console.log(`  No Oru contract found at ${contractAddress}.`);
    return;
  }
  console.log(`\n  Order book (${state.orderCount} order${state.orderCount === 1n ? '' : 's'} posted)`);
  if (state.orderCount === 0n) {
    console.log('  — empty —\n');
    return;
  }
  for (const [id, status] of state.statuses) {
    const client = toHex(state.clients.lookup(id)).slice(0, 16);
    const freelancer = state.freelancers.member(id) ? toHex(state.freelancers.lookup(id)).slice(0, 16) : '—';
    const detailsCommitment = toHex(state.detailCommitments.lookup(id)).slice(0, 16);
    console.log(
      `  #${id}  ${ORDER_STATUS_NAMES[status] ?? status}  client:${client}…  freelancer:${freelancer}${freelancer === '—' ? '' : '…'}  details:${detailsCommitment}…`,
    );
  }
  console.log('');
};

// ─── Wallet plumbing (adapted from example-counter) ─────────────────────────

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. This works around a bug in the wallet
 * SDK where signRecipe hardcodes 'pre-proof', which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    // Clone the intent with the correct proof marker.
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

/**
 * Create the unified WalletProvider & MidnightProvider for midnight-js.
 * This bridges the wallet-sdk-facade to the midnight-js contract API by
 * implementing balance, sign, finalize, and submit operations.
 */
export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      // Work around wallet SDK bug: signRecipe uses hardcoded 'pre-proof'
      // marker when cloning intents, but proven (UnboundTransaction) intents
      // have 'proof' data, causing "Failed to clone intent". We sign manually
      // with the correct proof markers.
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }

      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

const describeProgress = (label: string, progress: any): string => {
  try {
    const json = JSON.stringify(progress, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return `${label}=${json}`;
  } catch {
    return `${label}=?`;
  }
};

/** Wait until the wallet has fully synced with the network. Returns the synced state. */
export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(15_000),
      Rx.tap((state: any) => {
        if (!state.isSynced) {
          console.log(
            `\n  [sync] ${describeProgress('shielded', state.shielded?.state?.progress)} ${describeProgress('unshielded', state.unshielded?.progress)} ${describeProgress('dust', state.dust?.state?.progress)}`,
          );
        }
      }),
      Rx.filter((state) => state.isSynced),
    ),
  );

/** Wait until the wallet has a non-zero unshielded balance. Returns the balance. */
export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

/**
 * Derive HD wallet keys for all three roles (Zswap, NightExternal, Dust)
 * from a hex-encoded seed using BIP-44 style derivation at account 0, index 0.
 */
const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

/**
 * Runs an async operation with an animated spinner on the console.
 */
export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

/**
 * Register unshielded NIGHT UTXOs for dust generation.
 *
 * On Preprod/Preview, NIGHT tokens generate DUST over time, but only after
 * the UTXOs have been explicitly designated for dust generation via an on-chain
 * transaction. DUST is the non-transferable fee token used by the Midnight network.
 */
const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    console.log(`  ✓ Dust tokens already available (${formatBalance(dustBal)} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await withStatus('Waiting for dust tokens to generate', () =>
      Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
    );
    return;
  }

  await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  });

  await withStatus('Waiting for dust tokens to generate', () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

/**
 * Prints a formatted wallet summary showing all three wallet types
 * (Shielded, Unshielded, Dust) with their addresses and balances.
 */
const tryOr = (fallback: string, fn: () => string): string => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const printWalletSummary = (state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId = getNetworkId();
  const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  const shieldedAddress = tryOr('(unavailable)', () => {
    const coinPubKey = ShieldedCoinPublicKey.fromHexString(
      state.shielded.coinPublicKey.toHexString?.() ?? state.shielded.coinPublicKey,
    );
    const encPubKey = ShieldedEncryptionPublicKey.fromHexString(
      state.shielded.encryptionPublicKey.toHexString?.() ?? state.shielded.encryptionPublicKey,
    );
    return MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();
  });

  const DIV = '──────────────────────────────────────────────────────────────';

  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${tryOr('(unavailable)', () => MidnightBech32m.encode(networkId, state.dust.address).toString())}

${DIV}`);
};

/**
 * Build (or restore) a wallet from a hex seed, then wait for the wallet
 * to sync and receive funds before returning.
 */
export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('');

  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
    'Building wallet',
    async () => {
      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

      // ORU_FAST_SYNC=1: bootstrap the shielded/dust wallets from indexer
      // collapsed Merkle tree updates instead of replaying full chain history.
      // Only valid for wallets with no prior shielded/dust activity.
      let snapshots: FastSyncSnapshots | undefined;
      if (process.env.ORU_FAST_SYNC === '1') {
        console.log('\n  Fast-sync enabled (fresh wallet): bootstrapping from collapsed Merkle tree updates');
        snapshots = await buildFastSyncSnapshots(config, shieldedSecretKeys, dustSecretKey, getNetworkId());
      }

      const walletConfig = {
        ...buildShieldedConfig(config),
        ...buildUnshieldedConfig(config),
        ...buildDustConfig(config),
      };
      const wallet = await WalletFacade.init({
        configuration: walletConfig,
        shielded: (cfg) =>
          snapshots
            ? ShieldedWallet(cfg).restore(snapshots.shieldedSnapshot)
            : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
        unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
        dust: (cfg) =>
          snapshots
            ? DustWallet(cfg).restore(snapshots.dustSnapshot)
            : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);

      return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    },
  );

  const networkId = getNetworkId();
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Unshielded Address (send tNight here):
  ${unshieldedKeystore.getBech32Address()}

  Fund your wallet with tNight from the Preprod faucet:
  https://faucet.preprod.midnight.network/
${DIV}
`);

  const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));

  printWalletSummary(syncedState, unshieldedKeystore);

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    const fundedBalance = await withStatus('Waiting for incoming tokens', () => waitForFunds(wallet));
    console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/**
 * Create a fresh wallet with a randomly generated seed. The seed is displayed
 * once so the user can save it — it will not be shown again.
 */
export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  New Wallet Seed — save this before continuing
${DIV}
  ${seed}
${DIV}
`);
  return await buildWalletAndWaitForFunds(config, seed);
};

/**
 * Configure all midnight-js providers needed for contract deployment and interaction.
 */
export const configureProviders = async (ctx: WalletContext, config: Config) => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<OruCircuits>(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OruPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

/** Get the current DUST balance from the wallet state. */
export const getDustBalance = async (
  wallet: WalletFacade,
): Promise<{ available: bigint; pending: bigint; availableCoins: number; pendingCoins: number }> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const available = state.dust.balance(new Date());
  const availableCoins = state.dust.availableCoins.length;
  const pendingCoins = state.dust.pendingCoins.length;
  const pending = state.dust.pendingCoins.reduce((sum, c) => sum + c.initialValue, 0n);
  return { available, pending, availableCoins, pendingCoins };
};

/**
 * Monitor DUST balance with a live-updating display.
 * Resolves when the provided stop signal fires.
 */
export const monitorDustBalance = async (wallet: WalletFacade, stopSignal: Promise<void>): Promise<void> => {
  let stopped = false;
  void stopSignal.then(() => {
    stopped = true;
  });

  const sub = wallet
    .state()
    .pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
    )
    .subscribe((state) => {
      if (stopped) return;

      const now = new Date();
      const available = state.dust.balance(now);
      const availableCoins = state.dust.availableCoins.length;
      const pendingCoins = state.dust.pendingCoins.length;

      const registeredNight = state.unshielded.availableCoins.filter(
        (coin: any) => coin.meta?.registeredForDustGeneration === true,
      ).length;
      const totalNight = state.unshielded.availableCoins.length;

      let status = '';
      if (pendingCoins > 0 && availableCoins === 0) {
        status = '⚠ locked by pending tx';
      } else if (available > 0n) {
        status = '✓ ready to deploy';
      } else if (availableCoins > 0) {
        status = 'accruing...';
      } else if (registeredNight > 0) {
        status = 'waiting for generation...';
      } else {
        status = 'no NIGHT registered';
      }

      const time = now.toLocaleTimeString();
      console.log(
        `  [${time}] DUST: ${formatBalance(available)} (${availableCoins} coins, ${pendingCoins} pending) | NIGHT: ${totalNight} UTXOs, ${registeredNight} registered | ${status}`,
      );
    });

  await stopSignal;
  sub.unsubscribe();
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}

export { createOruPrivateState };
