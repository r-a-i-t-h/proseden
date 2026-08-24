# Proseden sample adventures

Opt-in worlds for playtesting how Proseden’s quest logic feels in different genres. They are **three different adventures**, not one plot in three themes. Default [`seed/`](../seed/) is unchanged.

| Sample | Genre | Boot |
|---|---|---|
| [`briefing/`](briefing/) | Spy HQ | `PROSEDEN_SEED=./samples/briefing` |
| [`fantasy/`](fantasy/) | Ruined keep | `PROSEDEN_SEED=./samples/fantasy` |
| [`derelict/`](derelict/) | Docked hulk | `PROSEDEN_SEED=./samples/derelict` |

Always pair with a fresh data dir, e.g. `PROSEDEN_DATA=/tmp/proseden-<name>-data`, then `npm start`. Login **admin** / **admin**.

## Idiom map (what each explores)

Reuse is intentional only where the engine has one clear verb; otherwise each sample prefers mechanics the others skip.

| Mechanic | Briefing | Fantasy | Derelict |
|---|---|---|---|
| Soft tick / atmosphere | Late-shift tape | — | O₂ drain → choking |
| Light / dark | Lamp var + Use torch | Tactile Input (`feel along the wall`) | — |
| Alchemy 2→1 | Dive kit | — | — |
| \`on: "drop"\` | — | Toll silver / wolf bait | — |
| \`on: "gain"\` | — | Mirror curse | Specimen quarantine |
| Multi-site Input rite | — | Three rite phrases → badge | — |
| Badge as world key | — | Tower \`badge:fey.anointed\` | — |
| \`giveArtefact\` mid-quest | — | Keep-key on rite | Chip on power flag |
| \`on: { flag }\` chain | — | — | Power → mint chip |
| Numeric / mantra Input | Safe \`3719\` | — | Breakers + dock mantra |
| Wait / season | Park leaves | — | — |
| Use-at-place gadget | Pass, dive, ladder | — | Patch, candle, decon |
| Win condition | Hold 3 evidence | Use letter on road (uncursed) | Use dock-release at **your** airlock |

After playtesting, the showcase pack can cherry-pick the strongest beats from all three.

## Regenerate

```bash
node scripts/build-briefing-sample.mjs
node scripts/build-fantasy-sample.mjs
node scripts/build-derelict-sample.mjs
```
