// Non-interactive Preprod deployment for Oru.
//
// Flow:
//   1. Load the wallet seed from $ORU_SEED or cli/wallet.seed,
//      generating (and saving) a fresh one if neither exists.
//   2. Build the wallet, print the unshielded address, and wait for tNight
//      (fund it at https://faucet.preprod.midnight.network/).
//   3. Register NIGHT UTXOs for DUST, wait for fee tokens to generate.
//   4. Deploy the Oru contract and print/save its address.
//
// Requires a proof server on http://localhost:6300.

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger-utils.js';
import { PreprodConfig, currentDir } from './config.js';
import * as api from './api.js';

const config = new PreprodConfig();
const logger = await createLogger(config.logDir);
api.setLogger(logger);

const seedPath = path.resolve(currentDir, '..', 'wallet.seed');
let seed = process.env.ORU_SEED ?? '';
if (!seed && fs.existsSync(seedPath)) {
  seed = fs.readFileSync(seedPath, 'utf8').trim();
  console.log(`Using existing wallet seed from ${seedPath}`);
}
if (!seed) {
  const { randomBytes } = await import('node:crypto');
  seed = randomBytes(32).toString('hex');
  fs.writeFileSync(seedPath, `${seed}\n`, { mode: 0o600 });
  console.log(`Generated a new wallet seed and saved it to ${seedPath}`);
  console.log('This file is gitignored — BACK IT UP somewhere safe.');
}

const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);
const providers = await api.configureProviders(walletCtx, config);
const privateState = api.createOruPrivateState(api.deriveOruSecretKey(seed));

const contract = await api.withStatus('Deploying Oru contract (generating ZK proof)', () =>
  api.deploy(providers, privateState),
);
const address = contract.deployTxData.public.contractAddress;

const DIV = '══════════════════════════════════════════════════════════════';
console.log(`
${DIV}
  DEPLOYED CONTRACT ADDRESS (Preprod)
${DIV}
  ${address}
${DIV}
`);
fs.writeFileSync(path.resolve(currentDir, '..', 'deployed-address.txt'), `${address}\n`);
console.log(`Address also saved to cli/deployed-address.txt`);

await walletCtx.wallet.stop();
process.exit(0);
