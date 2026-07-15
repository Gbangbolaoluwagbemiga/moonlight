// Print all wallet addresses (shielded, unshielded, dust) derived from the
// seed in cli/wallet.seed — no network access needed. The Preprod faucet
// expects the SHIELDED (mn_shield-addr_preprod1...) address.

import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'buffer';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { currentDir } from './config.js';

setNetworkId('preprod');
const networkId = getNetworkId();

const seedPath = path.resolve(currentDir, '..', 'wallet.seed');
const seed = (process.env.ORU_SEED ?? fs.readFileSync(seedPath, 'utf8')).trim();

const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');
const derivationResult = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
hdWallet.hdWallet.clear();
const keys = derivationResult.keys;

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
const coinPubKey = ShieldedCoinPublicKey.fromHexString(shieldedSecretKeys.coinPublicKey);
const encPubKey = ShieldedEncryptionPublicKey.fromHexString(shieldedSecretKeys.encryptionPublicKey);
const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();

const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

console.log(`Network:    ${networkId}`);
console.log(`Shielded:   ${shieldedAddress}`);
console.log(`Unshielded: ${unshieldedKeystore.getBech32Address()}`);
