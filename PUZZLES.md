# Puzzle exploration (middle ground)

Proseden remains a **shared prose world**, not an adventure-game engine.
This document proposes a thin layer of **conditions, holdings, and local
logic** so writers can build puzzle-shaped exploration without importing
parsers, quests, combat, NPCs, or campaign scoring.

Sphinx Adventure (and similar) are reference points for *scale of puzzle*,
not for product direction. The goal is the middle ground: enough state and
gating that a locked door, a filled bottle, or a nested satchel can matter —
without turning every visit into a single-player IF runtime.

Related: [SPEC.md](SPEC.md) (laws), [PLAN.md](PLAN.md) (shipped CMS scope),
[NAVIGATION.md](NAVIGATION.md) (go / teleport).

---

## Intent

| Keep | Add carefully | Still refuse |
|---|---|---|
| Prose-first scenes & artefacts | Conditional exits | Free-form verb–noun parser |
| HTTP as the interaction model | Per-reader puzzle state | Missions, scores, win screens as platform features |
| Collect-as-link keepsakes | Optional *holdings* for tools | Conversational NPCs |
| Multi-writer shared graph | Declarative gates & combines | Scripting languages / Turing-complete rules |
| File-backed, portable | Nested / combinable holdings | Combat, timers-as-fuel, random wanderers |

**Reader still plays no character.** Puzzle state is “what this account has
discovered, held, and combined,” not an avatar’s stats or inventory limit.

**There is still no platform mission.** A writer may *describe* a goal in
prose (“bring the tokens to the pedestal”). The server does not track
campaign progress, high scores, or endings unless a future opt-in *chamber*
feature needs a single local completion flag — and even then it stays
local, not a Proseden-wide quest system.

---

## Tension with current laws (and how to resolve it)

### 1. Collect is a link, not possession

Today, collecting bookmarks an artefact; it never leaves its home scene.
Puzzles need “I am holding the key.”

**Proposal:** two inventory modes, both visible under `/inv`:

| Mode | Name | Semantics |
|---|---|---|
| Keep (existing) | **keepsake** | Link to the shared artefact. Everyone may keep. Does not gate anything. |
| Hold (new) | **holding** | Per-reader possession used by gates and combines. May be unique to the reader’s puzzle state. |

Writers mark artefacts (or chamber-local item defs) as `holdable`. Keepsake
collect stays as now. Hold is a separate action (`POST …/hold`, drop returns
it to the reader’s puzzle pocket or to a scene slot — see below).

This preserves SPEC’s “collect what you love” while allowing tools that
actually do something.

### 2. “No mission”

Puzzles imply goals. Keep goals **in prose and in local gates**, not in a
global quest engine. Completing a chain may set a reader flag
(`gate:opened`) that changes *that reader’s* exits or detail text. No
leaderboard, no required ending.

### 3. Verb–noun stay out of scope ([PLAN.md](PLAN.md))

Do not add a parser. Expose a **small fixed action set** as HTTP routes and
HTML/text controls:

- go (already)
- examine / detail (already)
- keep / unkeep (collect — already)
- hold / drop (new)
- use (holding or scene fixture → target)
- combine (two holdings → result)
- open / close (optional sugar over `use` on fixtures)

Curl and HTML remain first-class. Synonyms are writer prose, not engine
vocabulary.

---

## Core ideas

### Reader flags (tiny blackboard)

Per authenticated reader, a flat map of string flags:

```ts
// data/users/<name>.json — additive field
puzzle?: {
  flags: Record<string, boolean | number | string>;
  holdings: Holding[];
};
```

Flags are set only by declared effects (never by free script). Examples:
`forge.lamp_lit`, `passage.cooled`, `chest.open`.

Unread / anonymous readers see the world with **no puzzle state** (all gates
evaluate as closed / default prose). Puzzle play requires a signed-in
account so state can persist.

### Predicates (conditions)

A small boolean language, JSON-only, evaluated against the reader’s puzzle
state and the current scene:

```ts
type Pred =
  | { flag: string; is?: boolean | number | string }   // default is: true
  | { holds: string }          // holding id or artefact slug
  | { holdsTag: string }       // any holding with tag
  | { not: Pred }
  | { all: Pred[] }
  | { any: Pred[] };
```

No arithmetic, no loops, no calls into prose. If a predicate references a
missing flag, it is false.

### Effects

When an action succeeds, apply a list of effects:

```ts
type Effect =
  | { setFlag: string; to?: boolean | number | string }
  | { clearFlag: string }
  | { give: string }           // add holding by id
  | { take: string }           // remove holding
  | { replace: { remove: string[]; give: string } }  // combine result
  | { moveHolding?: never };   // (reserve: later — place into scene slot)
```

Effects are the only “logic.” Writers compose them; the engine does not
interpret prose.

---

## Where definitions live

Prefer **chamber-scoped** definitions so the shared world stays calm.

### Chambers (opt-in puzzle scope)

A **chamber** is a group (or entrance-group) that opts into puzzle rules:

```json
// data/groups/<id>.json — additive
{
  "puzzle": {
    "enabled": true,
    "namespace": "forge",
    "items": { "...": "HoldingDef" },
    "actions": [ "..." ]
  }
}
```

- Flags used by that chamber should be prefixed with `namespace`
  (`forge.cooled`) to avoid collisions across writers.
- Exits and artefacts *outside* chambers ignore puzzle fields.
- Topographers / group managers edit chamber puzzle JSON; ordinary scene edit
  does not require touching logic.

Scenes and exits may carry **optional** gate fields even without a chamber;
chamber mode is the supported authoring path and the place for item defs.

### Gated exits

Extend exit records:

```ts
interface ExitRecord {
  exitId: number;
  nickname: string;
  toSceneId: number;
  createdAt: string;
  /** If set, go succeeds only when pred is true for this reader. */
  when?: Pred;
  /** Prose shown when go is denied (else a generic line). */
  whenDenied?: string;
}
```

Navigation rules elsewhere (entrance groups, ACL) still apply *after* the
gate passes. A gated exit is not a permissions bypass.

### Conditional detail / body variants (optional, phase 2)

Allow alternate detail text keyed by predicate so the fiery passage can
read “too hot” vs “hisses, cool enough” without cloning scenes:

```markdown
## detail:passage
The rock radiates heat…

## detail:passage when flag:forge.cooled
The rock is damp and dark. A way east has opened.
```

Exact on-disk syntax TBD; the requirement is **predicate-selected prose**,
not a template language.

---

## Holdings: hierarchy and combines

### Holding definitions

Chamber-local (or, later, artefact-linked) defs:

```ts
interface HoldingDef {
  id: string;                 // "bottle", "water", "satchel"
  title: string;
  /** Optional link to a world artefact for shared prose. */
  artefactId?: number;
  tags?: string[];            // "vessel", "liquid", "key"
  /** If set, this holding is a container. */
  capacity?: number;          // max child holdings; omit = not a container
  accepts?: Pred;             // what may be placed inside (tag/id checks)
  /** If false, holding cannot leave a scene slot (fixture). Default true. */
  portable?: boolean;
}
```

### Holding instances (per reader)

```ts
interface Holding {
  id: string;                 // def id
  instanceId: string;         // unique among this reader's holdings
  /** Nested children (hierarchy). */
  contains?: Holding[];
}
```

Hierarchy is **inventory-side only** in v1: a satchel in hand may contain a
key. Scene-side containers (chests in the room) can be phase 2 via scene
slots that mirror the same shape.

### Combine recipes

Declared in the chamber, not inferred:

```ts
interface CombineRule {
  id: string;
  /** Two holdings (by def id or tag) consumed from the reader’s hand/bag. */
  a: string;
  b: string;
  /** Resulting holding def id. */
  gives: string;
  /** Optional flag effects. */
  effects?: Effect[];
  /** Failure / success prose. */
  ok?: string;
  fail?: string;
}
```

`POST /puzzle/combine` with `{ a: instanceId, b: instanceId }` applies the
first matching rule. Order of `a`/`b` does not matter unless the writer
publishes two rules.

No crafting tree UI in v1 — list available combines only when both inputs
are held and a rule exists (optional hint; writers may omit hints).

### Relation to artefacts

- **Keepsake** → always the shared artefact page.
- **Holding** → may *point at* an artefact for description (`artefactId`),
  or be chamber-only prose (`title` + optional detail blob in the chamber
  file).
- Collect and hold are independent: you may keep a poem and separately hold
  a key that exists only as a holding def.

---

## Actions (HTTP surface)

Fixed verbs, chamber-aware:

| Action | Method (sketch) | Meaning |
|---|---|---|
| Go | `GET /s/:id/go/:exit` (existing) | Honour `when` on exit |
| Hold | `POST /s/:id/hold/:item` | Take portable holding from scene slot / give list |
| Drop | `POST /inv/holdings/:instanceId/drop` | Remove from hand; optional return to scene |
| Use | `POST /s/:id/use` body `{ item, target? }` | Match a declared use rule |
| Combine | `POST /puzzle/combine` | Match a combine rule |
| Stash / unstash | `POST …/contains` | Move holdings into/out of a container holding |

### Use rules

```ts
interface UseRule {
  id: string;
  item: string;          // holding def id or tag
  target?: string;       // scene fixture id, detail name, or holding id
  when?: Pred;
  effects: Effect[];
  ok?: string;
  fail?: string;
}
```

Example (cool the passage):

```json
{
  "id": "douse-passage",
  "item": "water",
  "target": "passage",
  "effects": [
    { "take": "water" },
    { "setFlag": "forge.cooled", "to": true }
  ],
  "ok": "Steam fills the corridor. The way east is bearable now."
}
```

Paired exit:

```json
{
  "exitId": 4,
  "nickname": "east",
  "toSceneId": 12,
  "when": { "flag": "forge.cooled" },
  "whenDenied": "The rock radiates heat. You cannot pass."
}
```

---

## Shared world vs per-reader state

**Default:** puzzle flags and holdings are **per reader**. Two visitors can
solve the same chamber independently. The shared prose graph does not flip
for everyone when one person opens a gate.

**Optional later:** `shared: true` on a flag for collaborative puzzles
(one opened gate for all). Defer until a real need appears — shared mutable
world state fights Proseden’s calm multi-writer model and complicates Live
presence.

Writers who want a “solved for everyone” exhibit can instead edit the scene
prose permanently (CMS), which is already the truth of the shared world.

---

## Phased delivery

### Phase A — Gates only

- `when` / `whenDenied` on exits
- Per-reader `flags` (set only via a tiny admin/test action or seed)
- Go evaluates predicates
- No new inventory yet

*Enough to prototype locked doors with manually set flags.*

### Phase B — Holdings + use

- `holdable` scene slots + hold/drop
- `UseRule` + effects (`setFlag`, `give`, `take`)
- Inventory UI lists keepsakes and holdings separately
- Chamber `puzzle` block on groups

*Enough for key/door, water/heat, lever/flag patterns.*

### Phase C — Hierarchy + combine

- Container holdings (`contains`, `capacity`, `accepts`)
- `CombineRule`
- Stash/unstash into bags

*Enough for “key in satchel” and simple crafting.*

### Phase D — Prose variants

- Predicate-selected details (and maybe exit visibility: hide vs deny)
- Optional one-shot `reveal` effects that permanently add a detail for that reader

### Explicit non-goals (all phases)

- Parser / synonym tables / disambiguation
- NPC dialogue trees or mobile enemies
- Lamp fuel, hunger, probability mazes
- Score, rank, achievements
- Full scene cloning per reader
- General-purpose scripting (JS in data files, etc.)

---

## Authoring sketch (minimal chamber)

Forge chamber: bottle on the grass, water at the lake, heat gate east.

1. Group `forge` with `puzzle.enabled` and item defs `bottle`, `water`.
2. Scene Lake: slot gives `water` when held bottle present + use fill rule
   (`replace` bottle → bottle_of_water), or simpler: use water source with
   empty bottle → `give: water`.
3. Scene Passage: use rule water + target passage → `forge.cooled`.
4. Exit east: `when: { flag: forge.cooled }`.

No parser. Three HTTP actions. Prose carries the fiction.

---

## Implementation constraints (when built)

- Still file-backed: puzzle defs on the group (or `data/chambers/<id>.json`
  if group files grow too crowded); reader state on the user record.
- Load into memory with the world; write-through on flag/holding changes
  (atomic user JSON rewrite, same as today).
- Text + HTML + JSON action results; Live presence need not understand
  puzzles beyond “user is in scene X.”
- ACL unchanged: you cannot hold or use in a scene you cannot read.
- Migration: missing `puzzle` fields = behaviour exactly as today.

---

## Open questions

1. **Scene slots vs artefact-linked holdings** — Should holdables always be
   chamber defs, or may an artefact be marked `holdable` and auto-offer Hold
   in its home scene?
2. **Drop into shared scenes** — Does dropping create a per-reader ghost
   object, a shared slot (messy), or only return to “pocket storage” until
   restashed at a designated table?
3. **Exit visibility** — Failed gate: show the exit but deny go (map-friendly),
   or hide the exit until `when` passes (discovery-friendly)? Default
   suggestion: **show + deny** with `whenDenied` prose; optional `hidden: true`.
4. **Anonymous play** — Keep puzzles auth-only, or allow cookie-local state
   that never syncs across devices?
5. **How much UI** — Sidebar action forms vs progressive disclosure only when
   the chamber defines actions for the current scene.

---

## Success criterion

A writer can build a **small chamber** (a handful of scenes, a few holdings,
one or two gates and combines) entirely with prose + declarative JSON, playable
via HTML and curl, without learning a parser and without changing how the rest
of Proseden feels for readers who only wander and keep artefacts.

If a design needs quest logs, combat, or arbitrary scripting, it is outside
this middle ground — and outside Proseden.
