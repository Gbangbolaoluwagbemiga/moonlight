import { AnimatePresence, motion } from 'motion/react';
import type { WalletStatus } from '../hooks/useMidnight';
import type { ConnectedWallet, NetworkProbeResult, WalletBalances } from '../lib/wallet';

interface WalletConnectProps {
  status: WalletStatus;
  wallet: ConnectedWallet | null;
  error: string | null;
  networkProbe: NetworkProbeResult[] | null;
  balances: WalletBalances | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onDetectNetwork: () => void;
}

const short = (addr: string, n = 10) => `${addr.slice(0, n)}…${addr.slice(-6)}`;

/** Sum every token amount in a balances record (all token types) into one bigint. */
const totalOf = (record: Record<string, bigint>): bigint =>
  Object.values(record).reduce((sum, v) => sum + v, 0n);

const dotClass: Record<WalletStatus, string> = {
  connected: 'status-dot status-dot--connected',
  connecting: 'status-dot status-dot--connecting',
  error: 'status-dot status-dot--error',
  disconnected: 'status-dot',
};

export function WalletConnect({ status, wallet, error, networkProbe, balances, onConnect, onDisconnect, onDetectNetwork }: WalletConnectProps) {
  return (
    <motion.div className="wallet-box card" layout transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
      <AnimatePresence mode="wait">
        {status === 'connected' && wallet ? (
          <motion.div
            key="connected"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '0.75rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1rem' }}>
              <div className="wallet-box__status-row">
                <span className={dotClass[status]} />
                <div>
                  <div className="wallet-box__label">Connected — {wallet.name}</div>
                  <div className="wallet-box__address" title={wallet.unshieldedAddress}>
                    {short(wallet.unshieldedAddress)}
                  </div>
                </div>
              </div>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} className="ghost" onClick={onDisconnect}>
                Disconnect
              </motion.button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.25rem', fontSize: '0.8rem', opacity: 0.85 }}>
              {balances ? (
                <>
                  <span>Network: <strong>{balances.networkId}</strong></span>
                  <span>Shielded: <strong>{totalOf(balances.shielded).toString()}</strong></span>
                  <span>Unshielded (NIGHT): <strong>{totalOf(balances.unshielded).toString()}</strong></span>
                  <span>Dust: <strong>{balances.dust.balance.toString()}</strong> / {balances.dust.cap.toString()}</span>
                </>
              ) : (
                <span style={{ opacity: 0.6 }}>Loading balances…</span>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1rem', flexWrap: 'wrap' }}
          >
            <div className="wallet-box__status-row">
              <span className={dotClass[status]} />
              <motion.button
                whileHover={{ scale: status === 'connecting' ? 1 : 1.04 }}
                whileTap={{ scale: status === 'connecting' ? 1 : 0.96 }}
                onClick={onConnect}
                disabled={status === 'connecting'}
              >
                {status === 'connecting' ? 'Connecting…' : 'Connect Lace Wallet'}
              </motion.button>
            </div>
            {status === 'disconnected' && <div className="wallet-box__hint">Not connected</div>}
            {status === 'error' && error && (
              <motion.div
                className="wallet-box__error"
                initial={{ x: 0 }}
                animate={{ x: [0, -6, 6, -4, 4, 0] }}
                transition={{ duration: 0.4 }}
              >
                {error}
                <button
                  onClick={onDetectNetwork}
                  style={{ marginLeft: '0.75rem', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                >
                  Detect network
                </button>
              </motion.div>
            )}
            {networkProbe && (
              <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', width: '100%' }}>
                {networkProbe.map(({ networkId, ok, reason }) => (
                  <div key={networkId} style={{ color: ok ? '#4ade80' : '#6b7280' }}>
                    {ok ? '✓' : '✗'} {networkId}{!ok && reason ? ` — ${reason}` : ''}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
