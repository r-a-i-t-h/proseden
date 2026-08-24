# Puzzle logic (quests, flags, alchemy)

Proseden remains a **shared prose world**, not an adventure-game engine.
This document is the design summary for **quests**, **flags**, **vars**,
**badges**, **flag-gated prose**, and **artefact alchemy**.

Related: [SPEC.md](SPEC.md), [PLAN.md](PLAN.md), [NAVIGATION.md](NAVIGATION.md).
Author guide for quest JSON: **[QUESTS.md](QUESTS.md)**.

---

## Intent

| Keep | Add | Refuse |
|---|---|---|
| Prose-first scenes & artefacts | Flag-gated exits, details, artefacts | Free-form parser |
| HTTP as the interaction model | Quests that set flags, vars, badges, artefacts | Platform missions / quest journal |
| Collect-as-link inventory | Use / input / gain / drop edges | Nested inventory |
| Multi-writer shared graph | Standalone N-ary alchemy | JS / embedded scripting / expression DSL |
| File-backed, portable | Manager JSON textareas | String vars, fixpoint cascade |

**No mission.** Players free-roam. Unfolding is woven into the world.
Rewards are prose (artefacts) and public badges — not a win screen.

**Two systems:**

1. **Quest evaluation** — rich `when` → `then` (flags, vars, badges, artefacts) → world Conditions.
2. **Artefact alchemy** — explicit combine of 2+ collected artefacts → grant result (not via flags).

---

## Two worlds

| Logic | Prose |
|---|---|
| Quests (`data/quests/<name>.json`, optional embedded `alchemy`) | Scenes, artefacts, exits |
| Flags (`data/users/<name>.flags.json`) — invisible | Scene **body** — never conditional |
| Vars (`data/users/<name>.vars.json`) — numeric | **Details** — hide by FlagRef condition |
| Badges (`data/users/<name>.badges.json`) — profile | Scene **access** — FlagRef condition (teleport bypass lock) |
| Alchemy recipes (`data/alchemy/recipes.json` + quest `alchemy` + `alchemy/users/*.json`) | |

---

## Flag bus and vars

**Flags** are set or clear (presence of `true`). Missing ≡ clear.

**Vars** are namespaced numbers (`quest.local`). Unset reads as **0**.
Authors may `setVar` (absolute), `incVar` / `decVar` (by a positive step,
default 1), or `clearVar` (delete the key). Explicit `0` is stored; only
`clearVar` removes the key.

Live facts also sit outside those files (`holds`, `atScene`, `scenesOwned`,
use/input/gain/drop edges). Quest rules use rich `when`; `then` may
`setFlag` / `clearFlag` / `setVar` / `incVar` / `decVar` / `clearVar` /
`grantBadge` / `giveArtefact` under the quest namespace.

One **quest evaluation** walks rules once in document order. Later rules see
earlier effects. Flag-edge and gain-edge rules (`on: { flag }` / `on: "gain"`)
react to changes earlier in the **same** evaluation — not a second run.

The prose world does **not** evaluate quest Pred trees. Exits, scene access,
details, and artefacts use a **FlagRef** condition string: flags,
`holds:<id>`, `badge:<id>`, `var:<id>=N` (and `!=` / `>` / `<`). Unknown schemes are
false. Randomness is quest-side only (`chance` / `setVar` with `random`); sticky
outcomes reach gates via the resulting flag or var.

```
rich when  →  then (flags / vars / badges / artefacts)
                 ↓
         world FlagRef (flag / holds / badge / var)
```

---

## Predicates

See [QUESTS.md](QUESTS.md) for the full table. Sketch:

```ts
type Pred =
  | { flag: string }
  | { holds: number }
  | { holdsTag: string }
  | { hasBadge: string }
  | { atScene: number }
  | { scenesOwned: number }       // ≥ N
  | { chance: number }            // 1/N probability; quest-only
  | { var: string; "=" | "!=" | ">" | "<": number }
  | { use: number } | { input: string } | { gain: number } | { drop: number }
  | { not: Pred } | { all: Pred[] } | { any: Pred[] };
```

**World gates** use FlagRef strings (below), not Pred trees.

---

## Quests

The JSON shape, `on` / `when` / `then`, order, and wakes are specified in
**[QUESTS.md](QUESTS.md)**.

One file per manager quest: `data/quests/<name>.json`. The `name` is the write
namespace. Managers edit via a giant JSON textarea (no fancy builder in v1).

Questors (staff role; managers included) edit a personal file at
`data/quests/users/<username>.json` via Edit toolbar **Quests**. The same page
has collapsible **Flags editor** and **Badges editor** panels for that user’s
`users/<username>.flags.json` and `users/<username>.badges.json` (handy for
testing; flags still stay invisible to ordinary readers). Managers edit
the official set via **Data → Quests**, and can open any personal quest file from
the same page (same giveArtefact ACL as the author’s own editor). Unlike alchemy
(open to every signed-in user), questor is **hand-picked** — personal quests add
more overhead and need elevated trust. The personal quest `name` must be
`user.<username>`; flags and badges use that prefix (for example
`user.raith.hamlet`). Manager namespaces stay flat (`builders.hamlet`). Manager
quests are evaluated before personal ones. Load faults in personal files are
skipped silently (logged). Unauthorized `giveArtefact` (home scene not owned or
managed) is rejected on save and omitted from the merge on load — same idea as
user alchemy. For a named official quest, ask a manager to register it under
Data → Quests.

Seed ships **`builders`** (scene-count threshold badges) and **`proseden`**
(empty shell that reserves the `proseden.*` prefix for the platform). Manager
quest name **`user`** is reserved for the personal `user.<username>.*` tree.
Release migration **`003-default-quests`** installs those two quests (and empty
alchemy recipes) into existing worlds when missing. Migration
**`005-user-quest-namespace`** rewrites legacy personal `username.*` ids to
`user.<username>.*`.

**Quest ≠ mission.** Always evaluable; never “started.” One evaluation = one
ordered pass (see QUESTS.md). Bad rules are skipped at load.

---

## World gates

World objects use a **FlagRef** string — not quest Pred trees. Empty = ungated.
First `:` splits `scheme` / payload. No colon → `flag` scheme (`flag:` is
optional). Invert with `not.` on the payload (`not.x`, `flag:not.x`,
`holds:not.1`, `var:not.x=0`). Unknown schemes are false.

| Written | True when |
|---|---|
| `quest.local` / `flag:quest.local` | `flags[id] === true` |
| `not.quest.local` / `flag:not.quest.local` | that flag is not `true` |
| `holds:12` | inventory contains artefact id `12` |
| `holds:not.12` | inventory does not contain that id |
| `badge:demo.x` | reader holds badge `demo.x` |
| `badge:not.demo.x` | reader does not hold that badge |
| `var:demo.n=3` | var equals 3 (unset reads as 0) |
| `var:demo.n!=0` | var is not 0 |
| `var:demo.n>1` / `var:demo.n<5` | strict greater / less |

**Lists:** `,` is AND within a group; `;` is OR between groups.
`a,b,c;d,e` means `(a AND b AND c) OR (d AND e)`. Empty pieces fail closed.
Do not put `,` or `;` inside flag, badge, or var ids.

`holdsTag`, `atScene`, `scenesOwned`, `use`, `input`, `gain`, `drop`, and
`chance` are not world-gate schemes (quest Pred only). Tag gates are too
general for world records. Random rolls stay in quests; gate on the sticky
flag/var they write.

```ts
type FlagRef = string; // atom | "a,b" (AND) | "a;b" (OR of groups)

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
possession; use a flag or var when you want sticky unlocks or rewards.

Anonymous readers: empty flags, inventory, badges, and vars → positive refs fail;
`not.*` / `holds:not.` / `badge:not.` / unset `var:…=0` succeed as appropriate.

---

## Badges

Public; listed and dropped **only on profile**. Granted via `{ "grantBadge" }`
in a rule’s `then`. Ids are `quest.local`. Held as `{ badge, grantTime }`
(`grantTime` is ISO; omitted displays as **unknown**). Each newly granted
badge also places a `notice` in the earner’s inbox (`You've earned a
badge …`, body = catalogue description when set).

---

## Alchemy (separate)

Master file `data/alchemy/recipes.json` (managers via **Data → Alchemy**),
optional **`alchemy` arrays on quest JSON** (manager and personal quest
editors), plus per-user files `data/alchemy/users/<username>.json` (every
signed-in user via Edit toolbar **Alchemy**). Master and user editors load
and save **file content**, not the merged in-memory list; quest recipes are
edited with the quest JSON. A successful save rebuilds the merge immediately.

Alchemy files are **per-user / master**, not ACL-shared: friends with scene
manage rights cannot edit your recipe file. Scene `canManage` only limits which
artefacts a **user** recipe (or personal-quest recipe) may `gives`. Manager
quest recipes are unrestricted like master recipes.

Inventory UI: collapsible **Alchemy** panel on `/inv`.

```ts
interface AlchemyRecipe {
  id: string;
  inputs: Array<number | { tag: string }>; // length >= 2
  gives: number | number[];
  ok?: string;
  // author?: string — in-memory only for user / personal-quest recipes
}
```

Combine uses master recipes first, then quest-embedded recipes (loaded quest
order), then user files (sorted by username). Quest recipe ids are namespaced
as `<questName>/<id>`; user recipe ids as `<username>/<id>`. Malformed user
files are skipped. User and personal-quest recipes whose `gives` are not
allowed for the author (missing artefact or no manage on home) are omitted
from the merge and skipped again at combine time.

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
data/quests/<name>.json          # may include optional alchemy[]
data/quests/users/<username>.json
data/alchemy/recipes.json
data/alchemy/users/<username>.json
data/users/<name>.flags.json
data/users/<name>.vars.json
data/users/<name>.badges.json
```

---

## Phased delivery

- **A** — Flags, single-pass quest eval, gated exits
- **B** — Detail + artefact visibility by flag
- **C** — Alchemy + Inventory panel + manager recipes editor
- **D** — Badges, profile drop, manager quest editor
- **E** — Vars, gain/drop edges, then rewards (no onFlag)

Migration: missing files/fields = behaviour as before this feature.

---

## Puzzle catalog

Need first, not capability first. Do not add visit counts or counters until a
concrete seed (or questor) puzzle needs them. Inventory is collect-as-link
(no quantities).

**Already expressible** (HTTP verbs: go, collect/uncollect, alchemy combine,
examine details, Use, Input):

- **Key and door** — live `holds:12` on exit/scene, or sticky `setFlag` if
  unlock should survive drop
- **Combine ingredients** — alchemy recipes; quests may later `{ "holds": resultId }`
- **Threshold mark** — `scenesOwned` → flag → badge (seed `builders`)
- **Hidden until** — `when` + `hidden` on exits/artefacts; `detailWhen` on details
- **Being there with an item** — `{ "all": [{ "atScene": N }, { "holds": id }] }` → flag
- **Use an artefact** — `on: "use"` + `{ "use": id }` (and other preds); button
  next to Drop; does not consume the artefact
- **Riddle / password** — `on: "input"` + `{ "input": "phrase" }` on a scene;
  private POST, not Live chat
- **Ordered stages** — numeric `setVar` + order of rules (higher step first for
  shared triggers); or a chain of boolean flags
- **Badge-gated prose** — `badge:quest.local`
- **Gain reaction** — `giveArtefact` then later `on: "gain"` / `{ "gain": id }`
  in the same evaluation

**Still rare / prefer facts over inventing ops:**

- **Visit N times** — usually flags or a var you advance on enter-like edges;
  no automatic visit counter yet

**Out of scope:** parser, NPC dialogue, inventory quantities/weight, timers,
shared mutable world flags, mission journal, JS in JSON, string vars,
fixpoint cascade.

---

## Non-goals

Parser, JS in data, expression DSL, string vars, nested
inventory, give/trade, conditional scene body, mission journal, per-quest
private flag stores, shared mutable world flags, fixpoint cascade.

---

## Success criterion

Managers edit official quest JSON and the master alchemy file; hand-picked
questors edit their personal quest file; every signed-in user may edit their own
alchemy file. Readers see flag- and var-gated prose, use Inventory Alchemy, earn/drop
badges on profile, and never see flags. Quest logic wakes on agreed events and
runs one ordered pass — without a mission to start.
