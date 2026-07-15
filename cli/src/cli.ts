// Oru CLI — interactive marketplace loop.
//
// Menu/flow structure adapted from midnightntwrk/example-counter
// (Apache-2.0, Copyright (C) Midnight Foundation).

import { type WalletContext } from './api';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { type StartedDockerComposeEnvironment, type DockerComposeEnvironment } from 'testcontainers';
import { type OruProviders, type DeployedOruContract } from './common-types';
import { type Config, StandaloneConfig } from './config';
import * as api from './api';
import { toHex } from '@midnight-ntwrk/midnight-js/utils';
import { Buffer } from 'buffer';

let logger: Logger;

/**
 * This seed gives access to tokens minted in the genesis block of a local development node.
 * Only used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// ─── Display Helpers ────────────────────────────────────────────────────────

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              O R U                                           ║
║              ─────                                           ║
║        A privacy-first freelance marketplace                 ║
║              built on Midnight                               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

const DIVIDER = '──────────────────────────────────────────────────────────────';

// ─── Menus ──────────────────────────────────────────────────────────────────

const WALLET_MENU = `
${DIVIDER}
  Wallet Setup
${DIVIDER}
  [1] Create a new wallet
  [2] Restore wallet from seed
  [3] Exit
${'─'.repeat(62)}
> `;

const contractMenu = (dustBalance: string) => `
${DIVIDER}
  Contract Setup${dustBalance ? `                      DUST: ${dustBalance}` : ''}
${DIVIDER}
  [1] Deploy a new Oru contract
  [2] Join an existing Oru contract
  [3] Monitor DUST balance
  [4] Exit
${'─'.repeat(62)}
> `;

const marketplaceMenu = (dustBalance: string) => `
${DIVIDER}
  Oru Marketplace${dustBalance ? `               DUST: ${dustBalance}` : ''}
${DIVIDER}
  [1] Post a work order        (client — details stay private)
  [2] Browse the order book    (public statuses + commitments)
  [3] Accept an order          (freelancer)
  [4] Complete an order        (client)
  [5] Cancel an order          (client)
  [6] Verify a budget commitment
  [7] Monitor DUST balance
  [8] Exit
${'─'.repeat(62)}
> `;

// ─── Wallet Setup ───────────────────────────────────────────────────────────

const buildWalletFromSeed = async (config: Config, rli: Interface): Promise<[WalletContext, string]> => {
  const seed = await rli.question('Enter your wallet seed: ');
  return [await api.buildWalletAndWaitForFunds(config, seed.trim()), seed.trim()];
};

/**
 * Wallet creation flow. Returns the wallet context plus the seed, which is
 * also used to derive the Oru marketplace identity key.
 */
const buildWallet = async (config: Config, rli: Interface): Promise<[WalletContext, string] | null> => {
  if (config instanceof StandaloneConfig) {
    return [await api.buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED), GENESIS_MINT_WALLET_SEED];
  }

  while (true) {
    const choice = await rli.question(WALLET_MENU);
    switch (choice.trim()) {
      case '1': {
        // buildFreshWallet prints the seed; we need it for identity derivation
        // too, so we generate here and pass it through the restore path.
        const seed = await rli.question(
          'A fresh wallet needs a seed. Press Enter to generate one randomly, or paste a 64-char hex seed: ',
        );
        if (seed.trim() === '') {
          const { randomBytes } = await import('node:crypto');
          const generated = Buffer.from(randomBytes(32)).toString('hex');
          console.log(`\n${DIVIDER}\n  New Wallet Seed — save this before continuing\n${DIVIDER}\n  ${generated}\n${DIVIDER}\n`);
          return [await api.buildWalletAndWaitForFunds(config, generated), generated];
        }
        return [await api.buildWalletAndWaitForFunds(config, seed.trim()), seed.trim()];
      }
      case '2':
        return await buildWalletFromSeed(config, rli);
      case '3':
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// ─── Contract Interaction ───────────────────────────────────────────────────

const getDustLabel = async (wallet: api.WalletContext['wallet']): Promise<string> => {
  try {
    const dust = await api.getDustBalance(wallet);
    return dust.available.toLocaleString();
  } catch {
    return '';
  }
};

const startDustMonitor = async (wallet: api.WalletContext['wallet'], rli: Interface): Promise<void> => {
  console.log('');
  const stopPromise = rli.question('  Press Enter to return to menu...\n').then(() => {});
  await api.monitorDustBalance(wallet, stopPromise);
  console.log('');
};

const printErrorChain = (e: unknown): void => {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`\n  ✗ Failed: ${msg}`);
  if (e instanceof Error && e.cause) {
    let cause: unknown = e.cause;
    let depth = 0;
    while (cause && depth < 5) {
      console.log(`    cause: ${cause instanceof Error ? cause.message : String(cause)}`);
      cause = cause instanceof Error ? cause.cause : undefined;
      depth++;
    }
  }
  if (msg.toLowerCase().includes('dust')) {
    console.log('    Insufficient DUST for transaction fees. Use the monitor option to watch your balance.');
  }
  console.log('');
};

const deployOrJoin = async (
  providers: OruProviders,
  walletCtx: WalletContext,
  privateStateSeed: string,
  rli: Interface,
): Promise<DeployedOruContract | null> => {
  const privateState = api.createOruPrivateState(api.deriveOruSecretKey(privateStateSeed));
  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    const choice = await rli.question(contractMenu(dustLabel));
    switch (choice.trim()) {
      case '1':
        try {
          const contract = await api.withStatus('Deploying Oru contract', () =>
            api.deploy(providers, privateState),
          );
          console.log(`  Contract deployed at: ${contract.deployTxData.public.contractAddress}\n`);
          return contract;
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '2':
        try {
          const contractAddress = await rli.question('Enter the contract address (hex): ');
          return await api.joinContract(providers, contractAddress.trim(), privateState);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '3':
        await startDustMonitor(walletCtx.wallet, rli);
        break;
      case '4':
        return null;
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

const askOrderId = async (rli: Interface): Promise<bigint | null> => {
  const raw = (await rli.question('Order id: ')).trim().replace(/^#/, '');
  try {
    return BigInt(raw);
  } catch {
    console.log(`  Invalid order id: ${raw}`);
    return null;
  }
};

/**
 * Main marketplace loop: post, browse, accept, complete, cancel, verify.
 */
const mainLoop = async (
  providers: OruProviders,
  walletCtx: WalletContext,
  privateStateSeed: string,
  rli: Interface,
): Promise<void> => {
  const contract = await deployOrJoin(providers, walletCtx, privateStateSeed, rli);
  if (contract === null) {
    return;
  }

  while (true) {
    const dustLabel = await getDustLabel(walletCtx.wallet);
    const choice = await rli.question(marketplaceMenu(dustLabel));
    switch (choice.trim()) {
      case '1':
        try {
          const details = await rli.question('Job details (kept private, only a hash goes on-chain): ');
          const budgetRaw = (await rli.question('Budget in tNight (kept private via commitment): ')).trim();
          const budget = BigInt(budgetRaw);
          const posted = await api.withStatus('Posting work order (generating ZK proof)', () =>
            api.postOrder(contract, details, budget),
          );
          console.log(`
  Order #${posted.orderId} posted in block ${posted.blockHeight} (tx ${posted.txId.slice(0, 20)}…)

  Budget salt — SAVE THIS to later prove the budget amount:
  ${toHex(posted.budgetSalt)}
`);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '2':
        try {
          await api.displayOrders(providers, contract);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '3':
        try {
          const id = await askOrderId(rli);
          if (id === null) break;
          const tx = await api.withStatus(`Accepting order #${id} (generating ZK proof)`, () =>
            api.acceptOrder(contract, id),
          );
          console.log(`  Order #${id} accepted in block ${tx.blockHeight}\n`);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '4':
        try {
          const id = await askOrderId(rli);
          if (id === null) break;
          const tx = await api.withStatus(`Completing order #${id} (generating ZK proof)`, () =>
            api.completeOrder(contract, id),
          );
          console.log(`  Order #${id} completed in block ${tx.blockHeight}\n`);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '5':
        try {
          const id = await askOrderId(rli);
          if (id === null) break;
          const tx = await api.withStatus(`Cancelling order #${id} (generating ZK proof)`, () =>
            api.cancelOrder(contract, id),
          );
          console.log(`  Order #${id} cancelled in block ${tx.blockHeight}\n`);
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '6':
        try {
          const id = await askOrderId(rli);
          if (id === null) break;
          const budget = BigInt((await rli.question('Claimed budget: ')).trim());
          const saltHex = (await rli.question('Budget salt (hex): ')).trim();
          const salt = new Uint8Array(Buffer.from(saltHex, 'hex'));
          const matches = await api.withStatus('Verifying budget commitment (generating ZK proof)', () =>
            api.verifyBudget(contract, id, budget, salt),
          );
          console.log(
            matches
              ? `  ✓ The commitment for order #${id} matches a budget of ${budget}\n`
              : `  ✗ The commitment for order #${id} does NOT match that budget/salt\n`,
          );
        } catch (e) {
          printErrorChain(e);
        }
        break;
      case '7':
        await startDustMonitor(walletCtx.wallet, rli);
        break;
      case '8':
        return;
      default:
        console.log(`  Invalid choice: ${choice}`);
    }
  }
};

// ─── Docker Port Mapping ────────────────────────────────────────────────────

const mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string) => {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);
  mappedUrl.port = String(container.getFirstMappedPort());
  return mappedUrl.toString().replace(/\/+$/, '');
};

// ─── Entry Point ────────────────────────────────────────────────────────────

export const run = async (config: Config, _logger: Logger, dockerEnv?: DockerComposeEnvironment): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);

  console.log(BANNER);

  const rli = createInterface({ input, output, terminal: true });
  let env: StartedDockerComposeEnvironment | undefined;

  try {
    if (dockerEnv !== undefined) {
      env = await dockerEnv.up();

      if (config instanceof StandaloneConfig) {
        config.indexer = mapContainerPort(env, config.indexer, 'oru-indexer');
        config.indexerWS = mapContainerPort(env, config.indexerWS, 'oru-indexer');
        config.node = mapContainerPort(env, config.node, 'oru-node');
        config.proofServer = mapContainerPort(env, config.proofServer, 'oru-proof-server');
      }
    }

    const walletResult = await buildWallet(config, rli);
    if (walletResult === null) {
      return;
    }
    const [walletCtx, seed] = walletResult;

    try {
      const providers = await api.withStatus('Configuring providers', () => api.configureProviders(walletCtx, config));
      console.log('');

      await mainLoop(providers, walletCtx, seed, rli);
    } catch (e) {
      if (e instanceof Error) {
        logger.error(`Error: ${e.message}`);
        logger.debug(`${e.stack}`);
      } else {
        throw e;
      }
    } finally {
      try {
        await walletCtx.wallet.stop();
      } catch (e) {
        logger.error(`Error stopping wallet: ${e}`);
      }
    }
  } finally {
    rli.close();
    rli.removeAllListeners();

    if (env !== undefined) {
      try {
        await env.down();
      } catch (e) {
        logger.error(`Error shutting down docker environment: ${e}`);
      }
    }

    logger.info('Goodbye.');
  }
};
