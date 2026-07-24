// One-off utility: send unshielded tNight from the CLI-managed Level 1 wallet
// to a shielded Preprod address (e.g. a Lace wallet), so the recipient has
// funds to test the Level 2 frontend with. Reads the seed from wallet.seed.
//
// Usage: node --loader ts-node/esm src/send-shielded.ts <shieldedAddress> [amount]
import { readFileSync } from 'node:fs';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { createLogger } from './logger-utils.js';
import { PreprodConfig } from './config.js';
import { buildWalletAndWaitForFunds, setLogger } from './api.js';

const [, , recipientArg, amountArg] = process.argv;
if (!recipientArg) {
  console.error('Usage: send-shielded.ts <shieldedAddress> [amount]');
  process.exit(1);
}

const config = new PreprodConfig();
const logger = await createLogger(config.logDir);
setLogger(logger);

const seed = readFileSync(new URL('../wallet.seed', import.meta.url), 'utf8').trim();
const { wallet, shieldedSecretKeys, dustSecretKey } = await buildWalletAndWaitForFunds(config, seed);

const recipient = MidnightBech32m.parse(recipientArg).decode(ShieldedAddress, getNetworkId());

const { firstValueFrom } = await import('rxjs');
const { filter } = await import('rxjs');
const state = await firstValueFrom(wallet.state().pipe(filter((s) => s.isSynced)));
const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

// Leave a small reserve in the CLI wallet for future fees/testing.
const RESERVE = 5_000_000n;
const amount = amountArg ? BigInt(amountArg) : balance > RESERVE ? balance - RESERVE : 0n;

console.log(`\nUnshielded balance: ${balance.toLocaleString()}`);
console.log(`Sending: ${amount.toLocaleString()} to ${recipientArg}\n`);

if (amount <= 0n) {
  console.error('Nothing to send (balance too low after reserve).');
  process.exit(1);
}

if (process.env.DRY_RUN === '1') {
  console.log('DRY_RUN=1 set — not submitting.');
  process.exit(0);
}

const recipe = await wallet.transferTransaction(
  [{ type: 'shielded', outputs: [{ type: unshieldedToken().raw, receiverAddress: recipient, amount }] }],
  { shieldedSecretKeys, dustSecretKey },
  { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: true },
);

const finalized = await wallet.finalizeRecipe(recipe);
await wallet.submitTransaction(finalized);

console.log('Submitted. Transaction identifiers:', finalized.identifiers());
process.exit(0);
