// Bridges the Lace (or any CIP-compatible) DApp Connector wallet to the
// midnight-js provider interfaces, mirroring what cli/src/api.ts does for the
// Node.js CLI wallet — but here proving is delegated to the wallet extension
// itself (via dappConnectorProofProvider) instead of a local proof server,
// and balancing/signing/submission go through the connector API instead of
// a locally-held seed.
import type { InitialAPI, WalletConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { Transaction, type SignatureEnabled, type Proof, type Binding } from '@midnight-ntwrk/ledger-v8';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { toHex, fromHex } from '@midnight-ntwrk/midnight-js/utils';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { type OruCircuits, OruPrivateStateId } from './common-types';

export const PREPROD_NETWORK_ID = 'preprod';

/** Candidate network ids to probe when diagnosing a "Network ID mismatch". */
export const CANDIDATE_NETWORK_IDS = ['preprod', 'testnet', 'preview', 'undeployed', 'mainnet'] as const;

export interface NetworkProbeResult {
  networkId: string;
  ok: boolean;
  reason?: string;
}

/**
 * Diagnostic: try `connect()` against a wallet with each candidate network id
 * and report which one the wallet accepts. Lace throws "Network ID mismatch"
 * for every id except the one it is actually configured for, so the `ok: true`
 * row tells us definitively which network the installed wallet is on.
 */
export const probeWalletNetworks = async (wallet: DetectedWallet): Promise<NetworkProbeResult[]> => {
  const results: NetworkProbeResult[] = [];
  for (const networkId of CANDIDATE_NETWORK_IDS) {
    try {
      setNetworkId(networkId);
      await wallet.api.connect(networkId);
      results.push({ networkId, ok: true });
    } catch (err) {
      const reason =
        err && typeof err === 'object' && 'reason' in err
          ? String((err as { reason?: unknown }).reason)
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ networkId, ok: false, reason });
    }
  }
  return results;
};

/** Path (relative to public/) where the compiled ZK circuit assets are served from. */
const ZK_CONFIG_BASE_URL = `${window.location.origin}/managed/oru`;

/**
 * Local proof server URL. Proving is delegated to a locally-run proof server
 * (matching the Level 1 CLI path) rather than to the wallet's hosted proof
 * server, which returns timeouts/400s for Preprod. Start it with
 * `npm run preprod-ps` (Docker, image proof-server:8.0.3 on :6300).
 */
export const PROOF_SERVER_URL = import.meta.env.VITE_PROOF_SERVER_URL ?? 'http://localhost:6300';

export interface DetectedWallet {
  key: string;
  api: InitialAPI;
}

/** Enumerate wallets injected under `window.midnight`. */
export const detectWallets = (): DetectedWallet[] => {
  const injected = window.midnight ?? {};
  return Object.entries(injected).map(([key, api]) => ({ key, api }));
};

/** Prefer a wallet whose name/key mentions "lace"; otherwise take the first detected. */
export const pickPreferredWallet = (wallets: DetectedWallet[]): DetectedWallet | undefined =>
  wallets.find((w) => /lace/i.test(w.key) || /lace/i.test(w.api.name)) ?? wallets[0];

export interface ConnectedWallet {
  key: string;
  name: string;
  api: WalletConnectedAPI;
  unshieldedAddress: string;
  shieldedCoinPublicKeyHex: string;
  shieldedEncryptionPublicKeyHex: string;
}

/** Connect to a detected wallet and resolve the addresses needed to build providers. */
export const connectWallet = async (wallet: DetectedWallet): Promise<ConnectedWallet> => {
  setNetworkId(PREPROD_NETWORK_ID);
  const api = await wallet.api.connect(PREPROD_NETWORK_ID);

  const { unshieldedAddress } = await api.getUnshieldedAddress();
  const { shieldedAddress } = await api.getShieldedAddresses();
  const decoded = MidnightBech32m.parse(shieldedAddress).decode(ShieldedAddress, getNetworkId());

  return {
    key: wallet.key,
    name: wallet.api.name,
    api,
    unshieldedAddress,
    shieldedCoinPublicKeyHex: decoded.coinPublicKey.toHexString(),
    shieldedEncryptionPublicKeyHex: decoded.encryptionPublicKey.toHexString(),
  };
};

export interface WalletBalances {
  networkId: string;
  shielded: Record<string, bigint>;
  unshielded: Record<string, bigint>;
  dust: { balance: bigint; cap: bigint };
}

/** Read the connected wallet's balances (shielded, unshielded, dust) and the network it reports. */
export const fetchWalletBalances = async (connected: ConnectedWallet): Promise<WalletBalances> => {
  const [config, shielded, unshielded, dust] = await Promise.all([
    connected.api.getConfiguration(),
    connected.api.getShieldedBalances(),
    connected.api.getUnshieldedBalances(),
    connected.api.getDustBalance(),
  ]);
  return { networkId: config.networkId, shielded, unshielded, dust };
};

/**
 * Bridges the connector's string(hex)-encoded transaction API to the
 * WalletProvider/MidnightProvider interfaces midnight-js expects.
 */
const createConnectorWalletProvider = (
  connected: ConnectedWallet,
): WalletProvider & MidnightProvider => ({
  getCoinPublicKey: () => connected.shieldedCoinPublicKeyHex,
  getEncryptionPublicKey: () => connected.shieldedEncryptionPublicKeyHex,
  async balanceTx(tx) {
    const { tx: balancedHex } = await connected.api.balanceUnsealedTransaction(toHex(tx.serialize()));
    return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
      'signature',
      'proof',
      'binding',
      fromHex(balancedHex),
    );
  },
  async submitTx(tx) {
    await connected.api.submitTransaction(toHex(tx.serialize()));
    const [txId] = tx.identifiers();
    if (!txId) throw new Error('Submitted transaction has no identifiers');
    return txId;
  },
});

/** Configure all midnight-js providers needed to join and call the Oru contract, using the connected wallet for proving, balancing and submission. */
export const configureConnectorProviders = async (connected: ConnectedWallet) => {
  const configuration = await connected.api.getConfiguration();
  const zkConfigProvider = new FetchZkConfigProvider<OruCircuits>(ZK_CONFIG_BASE_URL);
  const proofProvider = httpClientProofProvider<OruCircuits>(PROOF_SERVER_URL, zkConfigProvider);
  const walletAndMidnightProvider = createConnectorWalletProvider(connected);
  const storagePassword = `${Buffer.from(connected.shieldedCoinPublicKeyHex, 'hex').toString('base64')}!`;

  return {
    privateStateProvider: levelPrivateStateProvider<typeof OruPrivateStateId>({
      privateStateStoreName: 'oru-private-state-web',
      accountId: connected.shieldedCoinPublicKeyHex,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(configuration.indexerUri, configuration.indexerWsUri),
    zkConfigProvider,
    proofProvider,
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};
