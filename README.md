# 🌙 Oru

> A privacy-first freelance marketplace on [Midnight](https://midnight.network) — work orders whose details, budgets, and identities stay off the public ledger.

Built for the **Monthly Moonshots on Midnight** builder program. Current level: **Level 1 — New Moon** 🌑

## Contract Address

| Network | Address |
|---------|---------|
| Preprod | `43417527ae01b89855ed4befa4fc3a064bcb0f182d142cf3c15c00ad50051fa2` |
| Preview | _not deployed_ |

## What This Does

Oru is an on-chain registry for freelance work orders. A client posts a job; a freelancer accepts it; the client marks it complete (or cancels it while it's still open). The twist is *what the chain gets to see*: the public ledger stores only the order's lifecycle status and cryptographic commitments. The job description, the budget, and the real identities of both parties never appear on-chain — yet the contract still enforces the rules ("only the client can complete this order", "you can't accept your own job") inside zero-knowledge circuits, and any committed value can later be *proven* without being revealed.

The Level 1 contract ([contract/src/oru.compact](contract/src/oru.compact)) has 5 circuits: `postOrder`, `acceptOrder`, `completeOrder`, `cancelOrder`, and `verifyBudget`.

## Privacy Model

- **What is PUBLIC (on-chain, visible to anyone):**
  - The order counter and each order's lifecycle status (`OPEN → ASSIGNED → COMPLETED/CANCELLED`)
  - Commitments only: a SHA-256 hash of the job details, a salted hash of the budget, and identity hashes for client/freelancer
- **What is PRIVATE (private witness, never on-chain):**
  - `localSecretKey` — each participant's 32-byte secret key, supplied at proof time by their own machine ([witnesses.ts](contract/src/witnesses.ts)) and used only *inside* the circuit
  - The plaintext job details, the budget amount, and the budget salt — these exist only on the client's device
- **What the user PROVES without revealing:**
  - *"I am this order's client"* — by re-deriving the identity hash from the secret key in-circuit (`completeOrder`/`cancelOrder`), with no signature or wallet address exposed
  - *"I am not the client"* — freelancers prove they aren't self-dealing when accepting (`acceptOrder`)
  - *"The budget I claim matches what was committed"* — `verifyBudget` checks a claimed amount + salt against the on-chain commitment without the ledger ever storing the amount

### Public state vs private witness

- **Public ledger state** — everything declared with `export ledger` in [oru.compact](contract/src/oru.compact): replicated on every node, visible to anyone.
- **Private witness** — the `witness localSecretKey(): Bytes<32>` declaration: caller-supplied data used inside the ZK circuit that never leaves the device.
- **The `disclose()` boundary** — circuit parameters are private by default, and the compiler *refuses to compile* any flow where witness-derived data reaches the ledger without an explicit `disclose()`. Every disclosure in Oru is a deliberate, reviewable decision — see the `disclose(...)` calls in `postOrder` and friends.

## Tech Stack

- **Midnight network** (Preprod / Preview) — privacy-first blockchain
- **Compact** — Midnight's zero-knowledge circuit language (compiler 0.31.1 via compact devtools 0.5.1)
- **TypeScript** — contract bindings, tests (vitest), and deploy CLI (`@midnight-ntwrk/midnight-js` 4.x + wallet SDK)
- **Node.js ≥ 22**, npm workspaces
- **Docker** — local proof server (`midnightntwrk/proof-server`)

## Prerequisites

- Node.js ≥ 22 and npm
- Docker (for the local proof server, required to deploy/interact)
- [Compact developer tools](https://docs.midnight.network/getting-started/installation):
  ```sh
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  compact update
  ```

## Setup

```sh
git clone https://github.com/Gbangbolaoluwagbemiga/oru.git
cd oru
npm install
npm run compact      # compile the Compact contract (generates ZK circuits + keys + TS API)
npm run build        # build both packages
```

## Run Tests

```sh
npm test             # 10 simulator-based tests covering the full order lifecycle
```

## Deploy to Preprod

```sh
# Terminal 1 — proof server (or use `npm run preprod-ps --workspace cli` to auto-start it)
docker run -p 6300:6300 midnightntwrk/proof-server:8.0.3 -- midnight-proof-server -v

# Terminal 2 — interactive CLI
npm run preprod --workspace cli
```

The CLI walks you through:

1. Creating or restoring a wallet (fund it with tNight from the [Preprod faucet](https://faucet.preprod.midnight.network/))
2. Registering NIGHT UTXOs for DUST generation (DUST pays transaction fees)
3. Deploying the Oru contract (or joining an existing one by address)
4. Posting, browsing, accepting, completing, and cancelling work orders — each action generates a real ZK proof

## Repository Layout

```
contract/            Compact contract + TypeScript witness bindings
  src/oru.compact          The contract (5 circuits)
  src/witnesses.ts         Private witness (local secret key)
  src/managed/             Generated: ZK circuits, prover/verifier keys, TS API
  src/test/                Simulator-based unit tests (vitest)
cli/                 Deploy & interact with the contract on Preprod
  src/api.ts               Wallet + provider plumbing, contract operations
  src/cli.ts               Interactive marketplace menu
docs/                Submission notes, compile output, screenshots
.github/workflows/   CI: compile contract + run tests on every push
```

## Initial Idea

Oru is a freelance marketplace where the deal is on-chain but the details are not. Clients post work orders whose title, description, and budget exist on the public ledger only as cryptographic commitments; freelancers accept and deliver under pseudonymous identities derived in-circuit from local secret keys, so no wallet address is ever linked to an engagement. Rates, client lists, and work history — the data that today's freelance platforms expose to everyone including competitors — stay private, yet remain *provable*: any party can selectively disclose a committed value (like a budget) with a zero-knowledge proof when a dispute or an audit demands it. Later phases add private escrow and privately-computed reputation, giving freelancers in markets like Nigeria a way to build verifiable track records without publishing their income to the world.

## Screenshots

_See [docs/screenshots/](docs/screenshots/) — compile output and deployed contract address screenshots will be added here._

Compile output (text capture): [docs/compile-output.txt](docs/compile-output.txt)

## Roadmap (lunar cycle)

- 🌑 **Level 1 — New Moon:** toolchain, first contract, Preprod deployment ← *you are here*
- 🌒 **Level 2 — Waxing Crescent:** React frontend + Lace wallet connection
- 🌓 **Level 3 — First Quarter:** polished dApp, CI/CD, private escrow, program problem statement
- 🌔 **Level 4 — Waxing Gibbous:** MVP live on Preprod with docs + public profile
- 🌕 **Level 5 — Full Moon:** feedback loop, 50 Preprod users
- 🌝 **Level 6 — Supermoon:** Mainnet launch, 20 real users

## Acknowledgements

Wallet and provider plumbing in `cli/` is adapted from the official [midnightntwrk/example-counter](https://github.com/midnightntwrk/example-counter) (Apache-2.0), including its documented workarounds for wallet SDK signing issues. The contract, tests, and marketplace logic are Oru's own.

## License

Apache-2.0
