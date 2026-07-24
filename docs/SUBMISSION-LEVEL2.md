# Level 2 — Waxing Crescent: Submission Notes

Status against the Rise In requirements:

| Requirement | Status |
|---|---|
| Lace wallet connect / disconnect implemented | ✅ [WalletConnect.tsx](../web/src/components/WalletConnect.tsx) |
| Circuit called successfully from the frontend | ✅ `postOrder` via [CircuitCall.tsx](../web/src/components/CircuitCall.tsx) |
| Proof generated locally | ✅ `httpClientProofProvider` → local proof server (`localhost:6300`) in [lib/wallet.ts](../web/src/lib/wallet.ts) |
| An observable privacy behavior (something proven without being shown) | ✅ "Proved without revealing your input" label; private inputs never rendered — see ["Privacy Claim"](../README.md#privacy-claim) |
| Contract deployed to Preprod with a verifiable address | ✅ Preprod: `43417527ae01b89855ed4befa4fc3a064bcb0f182d142cf3c15c00ad50051fa2` (unchanged from Level 1) |
| Minimum 8 meaningful commits | ✅ see `git log --oneline` |
| Public GitHub repository with README | ✅ this repo, README updated with Level 2 sections |
| Live demo link (Vercel, Netlify, or similar) | ✅ [oru-web-beta.vercel.app](https://oru-web-beta.vercel.app/) |
| Deployed Preprod contract address (verifiable on-chain) | ✅ same as above |
| Demo video: wallet connect + a successful circuit call | ✅ [Watch on Loom](https://www.loom.com/share/1f8b2270477e4a34a2a049f2e78c38e9) |
| README documenting the privacy claim | ✅ ["Privacy Claim"](../README.md#privacy-claim) |

## On-chain evidence (Preprod)

A `postOrder` call was proved and confirmed on-chain from the browser DApp:

| Field | Value |
|---|---|
| Order ID | `0` |
| Transaction ID | `0075f258afa2172c4235b3644e9afb860be6f156613e6fb2386430a9a08d7d57e7` |
| Block height | `1791046` |

Only a salted commitment of the job details and budget is stored on-chain; the plaintext inputs and budget salt never left the browser. Fees were paid in DUST, generated after designating NIGHT for DUST generation in Lace.

## Reproducing locally

```sh
npm install
npm run compact
npm run build --workspace @oru/contract
# start a local proof server (proving happens here, not in the wallet)
docker run -d --name oru-proof-server -p 6300:6300 midnightntwrk/proof-server:8.0.3 'midnight-proof-server -v'
npm run dev --workspace web   # http://localhost:5173
```

Then: connect Lace (set to **Preprod**), fund it with tNight from the faucet, **designate the NIGHT for DUST generation** in Lace (fees are paid in DUST — without this the tank stays empty and submission fails), wait for DUST to appear, then post a work order from the UI.

## Demo video checklist (under 2 minutes)

1. Connect Lace wallet — show the address appear on screen.
2. Fill in job details + budget and call `postOrder` — show the "Generating proof…" loading state.
3. Show the on-chain result after submission (order id, transaction id, block height).
4. Point out the private input (job details, budget) was never shown anywhere in the UI, and the "Proved without revealing your input" label.

## Remaining steps

All Level 2 checklist items above are complete. Only the Rise In portal submission (pasting repo URL, live demo URL, and video link into the form) is left.
