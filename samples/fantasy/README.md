# Ashen Keep (`samples/fantasy`)

Original fantasy sample. **Different idioms from Night Briefing** on purpose.

| This sample uses | Briefing uses instead |
|---|---|
| `on: "drop"` toll / bait | Collect + Use pass / kit |
| `on: "gain"` curse | Soft tick / late-shift |
| Multi-site Input rite → **badge-as-key** | Numeric safe Input |
| `giveArtefact` on rite complete | Alchemy 2→1 |
| Tactile Input in dark (`feel along the wall`) | Lamp var + drain |
| **Use letter on the road** to win | Hold three evidence items |
| No alchemy, no wait/season | Alchemy dive + park wait |

Monsters are **avoided** (drop bait, whistle, sing) — no combat.

## Boot

```bash
rm -rf /tmp/proseden-fantasy-data
PROSEDEN_SEED=./samples/fantasy PROSEDEN_DATA=/tmp/proseden-fantasy-data npm start
```

**admin** / **admin**

## Map

```text
Misty Road — Bridge — Green — Hut / Stones / Smokehouse / Forest — Glade — Gate — Court
                                                                      |     |     |
                                                                 Cellars  Hall  Chapel
                                                                      |     |
                                                                   Niche  Tower (badge) — Study
```

## Critical path (spoiler)

1. Drop silver coin on the bridge → green.
2. Optional: leave the watching mirror or cleanse (shatter at stones / salt / wand) before delivery.
3. Input rite words at well (`name the keep`), chapel (`bind the ward`), stones (`open the sky`) → badge + key.
4. Clear wolves: drop haunch in glade, use whistle, or input `the long way home`.
5. Cellars: input `feel along the wall` → niche → letter (+ whistle).
6. Tower with badge → flavour. Use letter on Misty Road while uncursed → `fey.courier`.

## Regenerate

```bash
node scripts/build-fantasy-sample.mjs
```
