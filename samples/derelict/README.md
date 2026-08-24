# Umbilical (`samples/derelict`)

Original derelict-spacecraft sample. You dock, learn the crew is gone wrong, and must **return to your own airlock** alive.

**Different idioms from Night Briefing and Ashen Keep:**

| This sample | Others avoid overlapping |
|---|---|
| O₂ var init/drain → `choking` exit lockdown | Not lamp-drain; not soft late-shift flavour |
| `on: "gain"` contamination + medbay Use decon | Fantasy curse is mirror-specific; this is quarantine |
| Input breaker swap → `on: { flag }` → `giveArtefact` chip | No alchemy mint |
| `holds:boots` EVA gates (reactor/outer/breach) | Not dive-kit Use |
| Use patch at breach + Input nav mantra | Not safe code / rite words |
| Use dock-release **at your airlock** to win | Not hold-three / deliver-letter |
| No alchemy, no wait/season, no park/oak | — |

## Boot

```bash
rm -rf /tmp/proseden-derelict-data
PROSEDEN_SEED=./samples/derelict PROSEDEN_DATA=/tmp/proseden-derelict-data npm start
```

**admin** / **admin** — start in **Your Airlock**.

## Map

```text
Your Airlock — Umbilical — Bay — Spine — Berths / Galley / Medbay / Lab / Cargo / Locker
                               |     |
                          Blister   Engineering — Life Support
                               |          |
                            Bridge    Reactor — Outer — Breach
```

## Critical path (spoiler)

1. Bay: magnetic boots. Locker: O₂ candle (+ data stub clue). Galley: patch kit. Medbay: decon charge.
2. If air fails: life support → use candle (O₂ drains every wake).
3. Berths slate → engineering Input `swap a with c` → power + chip granted.
4. Boots → reactor → outer → breach → use patch kit.
5. Optional horror: lab vial contaminates; medbay use decon charge.
6. Bridge (power+chip): Input `umbra releases her children`.
7. Airlock: use dock release when powered, patched, nav ok, not contaminated → `hull.survivor`.

## Regenerate

```bash
node scripts/build-derelict-sample.mjs
```
