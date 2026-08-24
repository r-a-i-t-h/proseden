# Proseden sample adventures

Opt-in worlds for playtesting how Proseden’s quest logic feels in different genres. They are **separate adventures**, not one plot in several themes. Default [`seed/`](../seed/) is unchanged.

| Sample | Genre | Boot |
|---|---|---|
| [`briefing/`](briefing/) | Spy HQ | `PROSEDEN_SEED=./samples/briefing` |
| [`fantasy/`](fantasy/) | Ruined keep | `PROSEDEN_SEED=./samples/fantasy` |
| [`derelict/`](derelict/) | Docked hulk | `PROSEDEN_SEED=./samples/derelict` |
| [`outdoors/`](outdoors/) | Camp / woods | `PROSEDEN_SEED=./samples/outdoors` |

Always pair with a fresh data dir, e.g. `PROSEDEN_DATA=/tmp/proseden-<name>-data`, then `npm start`. Login **admin** / **admin**.

## Idiom map (what each explores)

Reuse is intentional only where the engine has one clear verb; otherwise each sample prefers mechanics the others skip.

| Mechanic | Briefing | Fantasy | Derelict | Outdoors |
|---|---|---|---|---|
| Soft tick / atmosphere | Late-shift tape | — | O₂ drain → choking | Night after sleep; **energy** for climb/pump |
| Light / dark | Lamp var + Use torch | Tactile Input | — | — |
| Alchemy | Dive kit | — | — | Tent, fire, stew, ladder, snare |
| \`on: "drop"\` | — | Toll / bait | — | — |
| \`on: "gain"\` | — | Mirror curse | Quarantine | — |
| Dynamic **details** | Shift / tape | Curse flavour | O₂ flavour | Tent, fire, stew, snare, **bike tyres**, bear |
| Detail **and** exit | — | — | — | Pitched tent → enter |
| Multi-site Input rite | — | Three phrases → badge | — | — |
| Badge as world key | — | Tower gate | — | — |
| \`giveArtefact\` mid-quest | — | Keep-key | Chip on power | Flea via tweezers |
| \`on: { flag }\` chain | — | — | Power → chip | Sleep → flat tyres or sprung snare |
| Woods / loop | — | — | — | Loop until **vantage** unlocks ridge |
| Win | Hold 3 evidence | Use letter on road | Use dock-release at airlock | Use bicycle when trailwise |

After playtesting, the showcase pack can cherry-pick the strongest beats.

## Regenerate

```bash
node scripts/build-briefing-sample.mjs
node scripts/build-fantasy-sample.mjs
node scripts/build-derelict-sample.mjs
node scripts/build-outdoors-sample.mjs
```
