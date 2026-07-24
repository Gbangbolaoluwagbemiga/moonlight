import { useCallback, useMemo, useState } from 'react';
import type { APIError } from '@midnight-ntwrk/dapp-connector-api';
import { type ConnectedWallet, type NetworkProbeResult, type WalletBalances, connectWallet, detectWallets, pickPreferredWallet, configureConnectorProviders, probeWalletNetworks, fetchWalletBalances } from '../lib/wallet';
import { createOruPrivateState, deriveOruSecretKey, joinOruContract, postOrder as postOrderTx, type PostedOrder } from '../lib/contract';
import type { OruProviders, DeployedOruContract } from '../lib/common-types';

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseMidnightState {
  status: WalletStatus;
  wallet: ConnectedWallet | null;
  contract: DeployedOruContract | null;
  error: string | null;
}

const describeConnectError = (err: unknown): string => {
  if (err && typeof err === 'object' && (err as { type?: unknown }).type === 'DAppConnectorAPIError') {
    const apiErr = err as APIError;
    if (apiErr.code === 'Rejected') return 'Connection request was rejected in the wallet.';
    if (apiErr.code === 'PermissionRejected') return 'Wallet permission was denied.';
    if (apiErr.code === 'Disconnected') return 'Lost connection to the wallet.';
    return `Wallet error: ${apiErr.reason || apiErr.code}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown wallet error';
};

/**
 * Connects to the Lace DApp Connector, wires up midnight-js providers backed
 * by the wallet (proving, balancing, and submission all happen through the
 * wallet extension), and joins the deployed Oru contract on Preprod.
 */
export function useMidnight(contractAddress: string) {
  const [state, setState] = useState<UseMidnightState>({
    status: 'disconnected',
    wallet: null,
    contract: null,
    error: null,
  });
  const [providers, setProviders] = useState<OruProviders | null>(null);
  const [networkProbe, setNetworkProbe] = useState<NetworkProbeResult[] | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, status: 'connecting', error: null }));
    try {
      const detected = detectWallets();
      const chosen = pickPreferredWallet(detected);
      if (!chosen) {
        throw new Error('No Midnight wallet extension found. Install Lace and refresh the page.');
      }

      const connected = await connectWallet(chosen);
      const builtProviders = await configureConnectorProviders(connected);
      const secretKey = await deriveOruSecretKey(connected.shieldedCoinPublicKeyHex);
      const contract = await joinOruContract(builtProviders, contractAddress, createOruPrivateState(secretKey));

      setProviders(builtProviders);
      setState({ status: 'connected', wallet: connected, contract, error: null });
      fetchWalletBalances(connected).then(setBalances).catch(() => setBalances(null));
    } catch (err) {
      setState({ status: 'error', wallet: null, contract: null, error: describeConnectError(err) });
    }
  }, [contractAddress]);

  const detectNetwork = useCallback(async () => {
    setNetworkProbe(null);
    const detected = detectWallets();
    const chosen = pickPreferredWallet(detected);
    if (!chosen) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'No Midnight wallet extension found. Install Lace and refresh the page.',
      }));
      return;
    }
    const results = await probeWalletNetworks(chosen);
    setNetworkProbe(results);
  }, []);

  const disconnect = useCallback(() => {
    // The DApp Connector API has no explicit disconnect call; we just drop
    // our local reference to the wallet API and providers.
    setProviders(null);
    setBalances(null);
    setState({ status: 'disconnected', wallet: null, contract: null, error: null });
  }, []);

  const postOrder = useCallback(
    async (details: string, budget: bigint): Promise<PostedOrder> => {
      if (!state.contract) throw new Error('Not connected to the contract yet');
      return postOrderTx(state.contract, details, budget);
    },
    [state.contract],
  );

  return useMemo(
    () => ({ ...state, providers, networkProbe, balances, connect, disconnect, detectNetwork, postOrder }),
    [state, providers, networkProbe, balances, connect, disconnect, detectNetwork, postOrder],
  );
}
