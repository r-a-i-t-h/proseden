# Puzzle logic (quests, flags, alchemy)

Proseden remains a **shared prose world**, not an adventure-game engine.
This document is the canonical design for **quests**, **flags**, **badges**,
**flag-gated prose**, and **artefact alchemy**.

Related: [SPEC.md](SPEC.md), [PLAN.md](PLAN.md), [NAVIGATION.md](NAVIGATION.md).
Quest file fields, predicates, knock-ons, and evaluation: **[QUESTS.md](QUESTS.md)**.

---

## Intent

| Keep | Add | Refuse |
|---|---|---|
| Prose-first scenes & artefacts | Flag-gated exits, details, artefacts | Free-form parser |
| HTTP as the interaction model | Quests that only set/clear **boolean** flags | Platform missions / quest journal |
| Collect-as-link inventory | Flag onChange → badge / artefact | Nested inventory |
| Multi-writer shared graph | Standalone N-ary alchemy | JS / embedded scripting / expression DSL |
| File-backed, portable | Manager JSON textareas | Player variables, coercion, per-quest flag silos |

Extension is named Pred atoms when a puzzle needs a new fact — not a variable store.

**No mission.** Players free-roam. Unfolding is woven into the world.
Rewards are prose (artefacts) and public badges — not a win screen.

**Two systems:**

1. **Quest + flag bus** — rich conditions → flags → world gates & knock-ons.
2. **Artefact alchemy** — explicit combine of 2+ collected artefacts → grant result (not via flags).

---

## Two worlds

| Logic | Prose |
|---|---|
| Quests (`data/quests/<name>.json`) | Scenes, artefacts, exits |
| Flags (`data/users/<name>.flags.json`) — invisible | Scene **body** — never conditional |
| Badges (`data/users/<name>.badges.json`) — profile | **Details** — hide by FlagRef condition |
| Alchemy recipes (`data/alchemy/recipes.json` + `alchemy/users/*.json`) | Scene **access** — FlagRef condition (teleport bypass lock) |

---

## Flag bus

Stored flags are **booleans** (set, clear, or set-to-false). Counts and
strings are not a second map: live facts sit outside the flag file
(`holds`, `atScene`, `scenesOwned`, …). New needs are a **named predicate**
(and a trigger if the fact is not already computed) — the `scenesOwned`
model, not `vars.foo += 1`.

Quest rules may use rich antecedents (holds, location, badges, other flags,
profile facts, …). Their `then` may **only** `setFlag` / `clearFlag` under
that quest’s namespace (`questName.local`).

When a flag’s stored value **actually changes**, declared `onFlag` knock-ons
run once for that transition (`grantBadge`, `giveArtefact`).

The prose world does **not** evaluate quest Pred trees. Exits, scene access,
details, and artefacts use a **FlagRef** condition string. The default is a
flag (`quest.local` / `not.quest.local`, or explicit `flag:`). Two live
reader facts are also allowed: current inventory (`holds:<id>`) and current
badges (`badge:<id>`). **Missing flag == false** for a positive flag ref.
Unknown schemes are false.

Tag checks (`holdsTag`), location (`atScene`), ownership counts, and
combinators stay in quest JSON. `holdsTag` is too general for world records
— it would encourage obscure category gates. Name a specific artefact or
badge, or set a flag from quest logic.

```
rich when  →  setFlag/clearFlag  →  onChange knock-ons
                 ↓
         world FlagRef (flag / holds / badge)
```

Same-value set is a no-op (no knock-on). Dropping a badge or uncollecting a
granted artefact does **not** re-grant while the flag stays true. Unset then
set again → knock-ons may fire again (re-earn). Live `holds:` / `badge:`
gates track **current** possession and do not fire knock-ons; use a flag
when you want sticky unlocks or rewards.

---

## Predicates

**Rich** (quest rules only):

```ts
type Pred =
  | { flag: string; is?: boolean } // default is: true
  | { holds: number }           // artefact id
  | { holdsTag: string }
  | { hasBadge: string }
  | { atScene: number }
  | { scenesOwned: { gte: number } }  // formal facts as added
  | { not: Pred }
  | { all: Pred[] }
  | { any: Pred[] };
```

Boolean `all` / `any` / `not` nest freely. Atoms do not grow arithmetic or
generic comparisons; a numeric fact carries its own fields (`scenesOwned.gte`).

**World gates** use FlagRef condition strings on world objects (see World
gates below), not Pred trees. `holdsTag` / `atScene` / `scenesOwned` stay
quest-only.

New puzzle support is a new Pred atom and/or eval trigger, documented in
[QUESTS.md](QUESTS.md) when added. Authors do not get a DSL to invent facts.

---

## Quests

The JSON shape, validation, and evaluation rules are specified in
**[QUESTS.md](QUESTS.md)** (this section is the design summary).

One file per manager quest: `data/quests/<name>.json`. The `name` is the write
namespace. Managers edit via a giant JSON textarea (no fancy builder in v1).

Questors (staff role; managers included) edit a personal file at
`data/quests/users/<username>.json` via Edit toolbar **Quests**. Managers edit
the official set via **Data → Quests** and their own file via the toolbar — same
split as alchemy (**Data → Alchemy** vs toolbar **Alchemy**). Unlike alchemy
(open to every signed-in user), questor is **hand-picked** — personal quests add
more overhead and need elevated trust. The quest `name` must be their username;
flags and badges use that prefix. Manager quests are evaluated before personal
ones. Load faults in personal files are skipped silently (logged). Unauthorized
`giveArtefact` (home scene not owned or managed) is rejected on save and omitted
from the merge on load — same idea as user alchemy. For a named official quest,
ask a manager to register it under Data → Quests.

Seed ships **`builders`** (scene-count threshold badges) and **`proseden`**
(empty shell that reserves the `proseden.*` prefix for the platform). There is
no hard-coded reserved-name list in the engine — presence of the manager quest
file owns the namespace. Release migration **`003-default-quests`** installs those
two quests (and empty alchemy recipes) into existing worlds when missing.

```ts
interface QuestFile {
  name: string;
  title?: string;
  description?: string;      // docs only
  rules: QuestRule[];
  onFlag?: Record<string, { onTrue?: KnockOn[]; onFalse?: KnockOn[] }>;
  badges?: BadgeDef[];       // ids must be name.*
}

interface QuestRule {
  id: string;
  when: Pred;                // rich
  then: Array<{ setFlag: string; to?: boolean } | { clearFlag: string }>;
}

type KnockOn =
  | { grantBadge: string }
  | { giveArtefact: number };
```

**Quest ≠ mission.** Always evaluable; never “started.”

### Evaluation triggers

Event-driven (no timer). Per authenticated user:

1. Login / session established
2. Arrive (successful go / teleport / resume)
3. Collect
4. Uncollect
5. Successful alchemy combine
6. Badge drop

After any flag change: run knock-ons, then evaluate again until quiet or max
iterations (16). Manager edits to quest/alchemy JSON are **lazy** — users
catch up on their next trigger.

**Faults:** invalid quest files are skipped at load; eval/gate failures are
logged as `[proseden:quest] …` for operators and never fail login, go, collect,
or other user actions.

Not triggers: anonymous views, heartbeats, scene create/delete.

Within one pass: all quests in load order (manager files sorted by name, then
questor personal files), all matching rules may fire.
Alchemy recipes remain first-match-wins on combine.

---

## World gates

World objects use a **FlagRef** string — not quest Pred trees. Empty = ungated.
First `:` splits `scheme` / payload. No colon → `flag` scheme (`flag:` is
optional). Invert with `not.` on the payload (`not.x`, `flag:not.x`,
`holds:not.1`). Unknown schemes are false.

| Written | True when |
|---|---|
| `quest.local` / `flag:quest.local` | `flags[id] === true` |
| `not.quest.local` / `flag:not.quest.local` | that flag is not `true` |
| `holds:12` | inventory contains artefact id `12` |
| `holds:not.12` | inventory does not contain that id |
| `badge:demo.x` | reader holds badge `demo.x` |
| `badge:not.demo.x` | reader does not hold that badge |

`holdsTag`, `atScene`, and `scenesOwned` are not world-gate schemes (quest
Pred only). Tag gates are too general for world records.

```ts
type FlagRef = string; // "quest.local" | "flag:…" | "holds:12" | "badge:demo.x"

// ExitRecord
when?: FlagRef;
whenDenied?: string;
hidden?: boolean;      // omit from lists until when passes; default show+deny

// SceneMeta — access only (body never gated)
when?: FlagRef;
whenDenied?: string;

// ArtefactMeta — listing / collect / direct /a/:id when not held
when?: FlagRef;

// Details — hide by name (body never gated)
detailWhen?: Record<string, FlagRef>;
// detailSwap — load-only legacy; prefer inverse FlagRef pairs instead
```

Authors usually set the **same** FlagRef on an inbound exit and the destination
scene so teleport cannot bypass a locked door — never auto-copied.

Edit UI: optional **Condition** (or **Conditions** for detail maps) disclosure,
closed by default. Quests still flip flags via manager JSON. Live `holds:` /
`badge:` on the world record is enough when the gate should track current
possession; use a flag when you need sticky state or `onFlag` knock-ons.

Anonymous readers: empty flags, inventory, and badges → positive refs fail;
`not.*` / `holds:not.` / `badge:not.` succeed.

---

## Badges

Public; listed and dropped **only on profile**. Granted only via flag
`onTrue` knock-on. Ids are `quest.local`. Held as `{ badge, grantTime }`
(`grantTime` is ISO; omitted displays as **unknown**). Each newly granted
badge also places a `notice` in the earner’s inbox (`You've earned a
badge …`, body = catalogue description when set).

---

## Alchemy (separate)

Master file `data/alchemy/recipes.json` (managers via **Data → Alchemy**) plus
per-user files `data/alchemy/users/<username>.json` (every signed-in user via
Edit toolbar **Alchemy**). Editors load and save **file content**, not the
merged in-memory list; a successful save rebuilds the merge immediately.

Alchemy files are **per-user / master**, not ACL-shared: friends with scene
manage rights cannot edit your recipe file. Scene `canManage` only limits which
artefacts a **user** recipe may `gives`.

Inventory UI: collapsible **Alchemy** panel on `/inv`.

```ts
interface AlchemyRecipe {
  id: string;
  inputs: Array<number | { tag: string }>; // length >= 2
  gives: number | number[];
  ok?: string;
  // author?: string — in-memory only for user recipes
}
```

Combine uses master recipes first, then user files (sorted by username). User
recipe ids are namespaced as `<username>/<id>`. Malformed user files are
skipped. User recipes whose `gives` are not allowed for the author (missing
artefact or no manage on home) are omitted from the merge and skipped again at
combine time.

`POST /alchemy/combine` with 2+ artefact ids from inventory. First matching
recipe wins. Gives result if not already held; inputs stay. Uncollect result
→ may combine again. No flag required. Already-held result uses a fixed
message (not per-recipe fail prose). Combine does not check whether the
recipient can read the result’s home scene (same as quest `giveArtefact`).

Holding the result grants artefact-page read even when the home is private or
flag-gated. It does not grant home-scene read, world collect, or edit history.
Drop the item and page read closes again. Homing alchemy products on a private
scene is the usual way to make them via-alchemy only.

Quests may later notice results via `holds` → `setFlag`.

---

## Storage

```
data/quests/<name>.json
data/quests/users/<username>.json
data/alchemy/recipes.json
data/alchemy/users/<username>.json
data/users/<name>.flags.json
data/users/<name>.badges.json
```

---

## Phased delivery

- **A** — Flags, quest load/eval/cascade, gated exits
- **B** — Detail + artefact visibility by flag
- **C** — Alchemy + Inventory panel + manager recipes editor
- **D** — Badges, profile drop, onFlag knock-ons, manager quest editor

Migration: missing files/fields = behaviour as before this feature.

---

## Puzzle catalog

Need first, not capability first. Do not add visit counts, guess-input, or
counters until a concrete seed (or questor) puzzle needs them. Inventory is
collect-as-link (no quantities). Strings have no natural source until a
dedicated guess POST exists.

**Already expressible** (HTTP verbs: go, collect/uncollect, alchemy combine,
examine details):

- **Key and door** — live `holds:12` on exit/scene, or sticky `setFlag` if
  unlock should survive drop
- **Combine ingredients** — alchemy recipes; quests may later `{ "holds": resultId }`
- **Threshold mark** — `scenesOwned` → flag → badge (seed `builders`)
- **Hidden until** — `when` + `hidden` on exits/artefacts; `detailWhen` on details
- **Being there with an item** — `{ "all": [{ "atScene": N }, { "holds": id }] }` → flag
- **Ordered rooms / levers** — a chain of boolean flags (`sawA`, `sawAthenB`),
  not a stage integer
- **Badge-gated prose** — `badge:quest.local`

**Would need a named primitive** (not implemented until a puzzle wants it):

- **Visit N times** — engine-maintained fact + something like
  `{ "visitCount": { "scene": N, "gte": 3 } }` on go — not a quest-authored
  counter variable
- **Riddle / password** — a dedicated guess form (new trigger), compare to a
  constant in the quest; the guess is input, not a stored string variable
- **Qualities / reputation** — usually milestone flags or artefacts, not a
  mutable number; only add a counter fact if a real puzzle cannot be told
  that way

**Out of scope:** parser, NPC dialogue, inventory quantities/weight, timers,
shared mutable world flags, mission journal, JS in JSON.

---

## Non-goals

Parser, JS in data, expression DSL, player variables, nested inventory,
give/trade, conditional scene body, mission journal, per-quest private flag
stores, shared mutable world flags.

---

## Success criterion

Managers edit official quest JSON and the master alchemy file; hand-picked
questors edit their personal quest file; every signed-in user may edit their own
alchemy file. Readers see flag-gated prose, use Inventory Alchemy, earn/drop
badges on profile, and never see flags. Quest logic wakes on agreed events and
cascades when flags change — without a mission to start.
