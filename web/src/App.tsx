import { motion } from 'motion/react';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';
import { useMidnight } from './hooks/useMidnight';

const CONTRACT_ADDRESS = import.meta.env.VITE_ORU_CONTRACT_ADDRESS ?? '';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

function App() {
  const { status, wallet, contract, error, networkProbe, balances, connect, disconnect, detectNetwork, postOrder } = useMidnight(CONTRACT_ADDRESS);

  return (
    <>
      <div className="aurora" aria-hidden="true" />
      <motion.main
        className="app"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      >
        <motion.header variants={fadeUp} transition={{ duration: 0.5 }}>
          <span className="eyebrow">🌒 Level 2 — Waxing Crescent</span>
          <h1>Oru</h1>
          <p>Private freelance work orders on Midnight</p>
        </motion.header>

        <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
          <WalletConnect status={status} wallet={wallet} error={error} networkProbe={networkProbe} balances={balances} onConnect={connect} onDisconnect={disconnect} onDetectNetwork={detectNetwork} />
        </motion.div>

        <motion.section className="contract-info" variants={fadeUp} transition={{ duration: 0.5 }}>
          <span>Preprod contract:</span>
          <code>{CONTRACT_ADDRESS || '(not configured — set VITE_ORU_CONTRACT_ADDRESS)'}</code>
        </motion.section>

        <motion.div className="card" variants={fadeUp} transition={{ duration: 0.5 }}>
          <CircuitCall connected={status === 'connected' && !!contract} onPostOrder={postOrder} />
        </motion.div>
      </motion.main>
    </>
  );
}

export default App;
