import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { PostedOrder } from '../lib/contract';

interface CircuitCallProps {
  connected: boolean;
  onPostOrder: (details: string, budget: bigint) => Promise<PostedOrder>;
}

type CallState = { phase: 'idle' } | { phase: 'proving' } | { phase: 'done'; result: PostedOrder } | { phase: 'error'; message: string };

export function CircuitCall({ connected, onPostOrder }: CircuitCallProps) {
  const [details, setDetails] = useState('');
  const [budget, setBudget] = useState('');
  const [call, setCall] = useState<CallState>({ phase: 'idle' });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!connected || !details || !budget) return;

    setCall({ phase: 'proving' });
    try {
      // `details` and `budget` are passed straight into the circuit call —
      // they are never rendered anywhere in this UI, only their on-chain
      // commitments (returned inside `result`) are.
      const result = await onPostOrder(details, BigInt(budget));
      setCall({ phase: 'done', result });
      setDetails('');
      setBudget('');
    } catch (err) {
      setCall({ phase: 'error', message: err instanceof Error ? err.message : 'Circuit call failed' });
    }
  };

  return (
    <div className="circuit-call">
      <h2>Post a Work Order</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Job details (private — never sent to the chain in plaintext)
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="e.g. Build a landing page for..."
            disabled={!connected || call.phase === 'proving'}
            required
          />
        </label>
        <label>
          Budget in tNight (private — only a salted commitment is stored)
          <input
            type="number"
            min="1"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={!connected || call.phase === 'proving'}
            required
          />
        </label>
        <motion.button
          type="submit"
          disabled={!connected || call.phase === 'proving'}
          whileHover={{ scale: connected && call.phase !== 'proving' ? 1.02 : 1 }}
          whileTap={{ scale: connected && call.phase !== 'proving' ? 0.98 : 1 }}
        >
          {call.phase === 'proving' ? 'Generating proof…' : 'Call postOrder'}
        </motion.button>
      </form>

      <AnimatePresence mode="wait">
        {call.phase === 'proving' && (
          <motion.p
            key="proving"
            className="circuit-call__status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <span className="spinner" />
            <span>
              Generating a zero-knowledge proof in your wallet and submitting the transaction. This proves the order
              was posted correctly — <strong>without revealing the details or budget you entered.</strong>
            </span>
          </motion.p>
        )}

        {call.phase === 'done' && (
          <motion.div
            key="done"
            className="circuit-call__result"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          >
            <motion.p
              className="circuit-call__proved-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <motion.span
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 15 }}
              >
                ✓
              </motion.span>
              Proved without revealing your input
            </motion.p>
            <dl>
              <dt>Order ID</dt>
              <dd>{call.result.orderId.toString()}</dd>
              <dt>Transaction ID</dt>
              <dd>{call.result.txId}</dd>
              <dt>Block height</dt>
              <dd>{call.result.blockHeight}</dd>
            </dl>
            <p className="circuit-call__hint">
              Only a commitment hash of the details and budget is now on-chain — save the budget salt below if you'll
              need to prove the budget later via <code>verifyBudget</code>:
            </p>
            <code className="circuit-call__salt">{Buffer.from(call.result.budgetSalt).toString('hex')}</code>
          </motion.div>
        )}

        {call.phase === 'error' && (
          <motion.p
            key="error"
            className="circuit-call__error"
            initial={{ opacity: 0, x: 0 }}
            animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {call.message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
