# Level 1 — New Moon: Submission Notes

Status against the Rise In requirements:

| Requirement | Status |
|---|---|
| Toolchain installed, contract compiles via `compact compile` | ✅ compact 0.5.1 / compiler 0.31.1 — see [compile-output.txt](compile-output.txt) |
| Passing test suite | ✅ 10/10 (`npm test`) |
| Generated `managed/` directory present (circuits + keys) | ✅ committed at [contract/src/managed/oru](../contract/src/managed/oru) |
| Contract deployed to Preview or Preprod with visible address | ✅ Preprod: `43417527ae01b89855ed4befa4fc3a064bcb0f182d142cf3c15c00ad50051fa2` |
| Initial product idea paragraph in README | ✅ ["Initial Idea"](../README.md#initial-idea) |
| README section: public state vs private witness | ✅ ["Public state vs private witness"](../README.md#public-state-vs-private-witness) |
| Minimum 5 meaningful commits | ✅ see `git log --oneline` |
| Screenshot: successful compile output | ⏳ run `npm run compact` and capture the terminal |
| Screenshot: contract deployed with address shown | ⏳ after deployment |

## Reproducing the compile

```sh
npm install
npm run compact
```

Expected output lists all 5 circuits with their constraint counts (see
[compile-output.txt](compile-output.txt)). Screenshots go in
[docs/screenshots/](screenshots/).

## Deploying

Requires Docker (proof server) and a wallet funded with tNight from the
[Preprod faucet](https://faucet.preprod.midnight.network/):

```sh
npm run preprod-ps --workspace cli   # auto-starts the proof server container
```

Choose "Create a new wallet", fund the printed address, let the CLI register
NIGHT for DUST generation, then "Deploy a new Oru contract". The
deployed address is printed on success — capture the screenshot and update
the README's "Deployed contract (Preprod)" line.
