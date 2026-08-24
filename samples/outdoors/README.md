# Pitch & Pine (`samples/outdoors`)

A **great outdoors** sample built to showcase **dynamic details and exits**: the meadow shelf describes where to pitch; after pitching, the tent is both a **detail** and a **hidden exit**; the bike’s detail flips with tyre state; fire, stew pot, and snare appear as details when earned; the pine woods loop until a **vantage** unlocks a ridge exit.

Premise: arrive soft, leave **trailwise** — not a combat saga, a transformation through campcraft, pests, and reading the land.

## Boot

```bash
rm -rf /tmp/proseden-outdoors-data
PROSEDEN_SEED=./samples/outdoors PROSEDEN_DATA=/tmp/proseden-outdoors-data npm start
```

**admin** / **admin**

## Dynamic prose & exits (the point)

| State | What changes |
|------|----------------|
| Tent pitched | Detail `tent_pitched` + exit **tent** into scene 3 |
| Fire lit / stew eaten | Details `fire_lit`, `stew_pot` on the meadow |
| Snare armed / sprung | Details on the meadow |
| Tyres flat / firm | Details `bike_flat` / `bike_firm` at Lane End |
| Ladder on oak | Detail `aid`; exit **up** needs ladder + energy |
| Vantage seen | Hidden exit **ridge** from Pine Gloom |
| Bear present | Detail + blocks return until flea diplomacy |

## Energy & the miscreant

- Sleeping (bag **inside tent**) advances night and gives fleas; without a snare, tyres go flat.
- Arm snare on the meadow **before** sleep → miscreant scared, tyres stay firm.
- Pumping flat tyres sets energy to 0 — you must eat stew before setting/climbing the oak.
- So: scare the miscreant **or** spend a meal-cycle on the pump before the vantage climb.

## Critical path (spoiler)

1. Stump: sticks, spark, tweezers, stake, wrapper. Brook: reed cord, oats, vine, wire. Berries: sheet, tinder, berries.
2. Alchemy: tent (sticks+cord+sheet), fire kit, stew, rope-ladder, snare.
3. Meadow: use tent → enter tent; use fire kit; use stew (energy 3); use snare.
4. Tent: use sleeping bag → fleas; tweezers → captured flea.
5. (If no snare) Lane: use pump → firm tyres, energy 0 → eat again.
6. Oak: use rope-ladder (needs energy > 1) → up → crown (sets vantage).
7. Pines: bear after first night — use flea → ridge exit (needs vantage).
8. Lane: use bicycle when firm tyres + vantage + fed → badge `camp.trailwise`.

## Regenerate

```bash
node scripts/build-outdoors-sample.mjs
```
