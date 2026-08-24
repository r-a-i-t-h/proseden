# Night Briefing (`samples/briefing`)

Original **Spycatcher-spirited** spy/HQ sample for Proseden — compact Bureau building, gadgets, soft time, wordplay alchemy. **Not** a port of Spy Snatcher / Spycatcher (or any other commercial title).

Default [`seed/`](../../seed/) is unchanged. This tree is opt-in for playtest and iteration.

## Boot

From the repo root, use an empty data directory so the sample is copied on first load:

```bash
rm -rf /tmp/proseden-briefing-data
PROSEDEN_SEED=./samples/briefing PROSEDEN_DATA=/tmp/proseden-briefing-data npm start
```

Sign in as **admin** / **admin** (same as seed). Resume lands in the Night Lobby.

If `PROSEDEN_DATA` already has a `meta.json`, the seed is **not** re-copied — wipe that data dir or point at a fresh path.

## Map

```text
                    [Flat Roof]
                         |
Night Lobby ---- Ground Corridor ---- Roof Stair
    |                 |    |  |  \
 Courtyard Park       |    |  |   Comms / Canteen / Plant / Yard
    |                 |    |  +-- Archive Landing -> Stacks -> Flooded -> Under-cistern
  Old Oak ---- Branches   |  +-- Records / Annexe -> Director
    |                     +-- Evidence Cage (pass)
 Service Yard
```

Entrance group **Bureau night shift** forces teleports back to the Night Lobby.

## Puzzle checklist

| Beat | How |
|------|-----|
| Soft time | Every quest wake `incVar spy.tick`; after tick > 24, `spy.shiftLate` (lobby board / comms tape details) |
| Lamp | **Use** pocket torch → `spy.lamp=12`, drains each wake; archive lower door needs `var:spy.lamp>0` |
| Memo + safe | Collect cryptic memo + look at annexe calendar → Input `3719` in Director's Office → clearance chit |
| Pass | Collect visitor pass → **Use** in Ground Corridor → Evidence Cage exit |
| Alchemy | Combine **snorkel parka** + **welding mask** → dive kit → **Use** in Flooded Sub-basement → hatch exit |
| Season / wait | In Courtyard Park, Input `wait` twice → leaves fall → **Use** ladder at Old Oak → Branches → microfilm |
| Win | Hold microfilm + wet notebook + clearance chit → badge `spy.briefed` |

## Critical path (spoiler)

1. Desk → visitor pass; Records → memo; Annexe → calendar hint; Director → input `3719` → chit.
2. Corridor → use pass → Evidence Cage (flavour); Plant → torch + welding mask; Canteen → snorkel parka.
3. Alchemy combine → dive kit; torch on; Archive → Flooded → use kit → Under-cistern → wet notebook.
4. Yard → ladder; Park → wait, wait; Oak → use ladder → Branches → microfilm.
5. Badge grants when all three evidence artefacts are held.

## Iterate

- Prose is intentionally stubby — thicken without changing ids if you can help it (quest rules hard-code artefact/scene ids).
- Prefer new puzzles via `quests/spy.json` FlagRefs over new engine features.
- Regenerate the world from the content script after structural edits:

```bash
node scripts/build-briefing-sample.mjs
```

- When stable, load this world and call adventure-pack export (HTTP UI may land later).
