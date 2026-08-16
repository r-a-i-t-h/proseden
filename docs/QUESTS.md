# Quest JSON

This is the current on-disk definition of a **quest file**: one JSON object that
names a flag/badge namespace, lists rules that set or clear flags, and may
declare knock-ons and badge copy.

Design intent (flag bus vs alchemy, world gates, non-goals) lives in
[PUZZLES.md](PUZZLES.md). This document matches the parser and evaluator in
`src/logic/quests.ts`, `src/logic/pred.ts`, and `src/model/logic.ts`.

Managers edit official quests at **Data → Quests** (`/data/quests`), or by writing
files under `data/quests/<name>.json`. Hand-picked **questors** (staff role; not
open to all users the way alchemy is) edit their personal file via Edit toolbar
**Quests** (`/quests`) → `data/quests/users/<username>.json`. Managers use the
same split as alchemy: **Data** for the shared/official set, toolbar **Quests**
for their own username file. Seed copies are `seed/quests/*.json`.

---

## Files

| Path | Role |
|---|---|
| `data/quests/<name>.json` | Manager (official) quest — one quest per file |
| `data/quests/users/<username>.json` | Questor personal quest — `name` must equal username |
| `data/users/<username>.flags.json` | That reader’s flag map (`{ "quest.local": value, … }`) |
| `data/users/<username>.badges.json` | That reader’s badge ids (JSON array of strings) |

The live manager filename should be **`<name>.json`**, matching the object’s `name`
field. The loader uses `name` from JSON, not the filename. The manager save
path writes `data/quests/<name>.json` and rejects a body whose `name` differs
from the URL.

Personal questor files use the **username as the write namespace** (flags/badges
must be `username.local`). Manager quests are loaded and evaluated **before**
user files. Invalid user files, wrong `name`, namespaces already owned by a
manager quest, or unauthorized `giveArtefact` targets are **skipped at load**
(logged as `[proseden:quest] …`) without blocking other quests.

`name` is the **write namespace**. Every flag id, badge id, and `onFlag` key
in the file must be `name.` plus a non-empty local part (e.g. quest `demo`
may set `demo.found`, never `other.found` or `demo.`).

For an **official** named quest (not tied to a username), a manager registers
it under Data → Quests (or the questor is promoted to manager).

There is no reserved-name list in the engine. Presence of a manager file owns
that prefix. Seed ships **`builders`** (scene-count badges) and **`proseden`**
(empty shell that reserves `proseden.*`). Migration `003-default-quests`
installs those two files (and empty alchemy recipes) when missing; it does
not overwrite edits.

Invalid files are skipped at load and logged as `[proseden:quest] …`.
Unknown extra JSON keys are ignored on parse and dropped if the manager
saves the parsed object.

---

## Top-level object

```json
{
  "name": "demo",
  "title": "Demo quest",
  "description": "Optional notes for managers. Not shown to readers.",
  "rules": [],
  "onFlag": {},
  "badges": []
}
```

| Field | Required | Type | Meaning |
|---|---|---|---|
| `name` | yes | string | Identifier and namespace. Trimmed. Must match `/^[A-Za-z][A-Za-z0-9_-]*$/`. |
| `title` | no | string | Display label. Coerced with `String()`. |
| `description` | no | string | Manager-facing notes only. Coerced with `String()`. |
| `rules` | yes | array | May be empty. Each element is a [rule](#rules). |
| `onFlag` | no | object | Flag id → [knock-ons](#onflag-knock-ons) when that flag’s stored value **changes**. |
| `badges` | no | array | Badge catalogue for this namespace. Copy for the profile shelf. |

A quest is **not** a mission. It is always eligible; readers never “start”
or “complete” it. Empty `rules` is valid (used to reserve a prefix).

---

## Rules

```json
{
  "id": "found-key",
  "when": { "holds": 12 },
  "then": [{ "setFlag": "demo.hasKey", "to": true }]
}
```

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | no | string | Stable id for logs. Default `rule-<index>` (0-based). |
| `when` | yes | [predicate](#predicates) | Rich condition. If true, `then` runs. |
| `then` | yes | non-empty array | Only [`setFlag` / `clearFlag`](#flag-effects). |

`grantBadge` and `giveArtefact` are **not** allowed in `then`. Those are
knock-ons on flag **transitions** (`onFlag`).

Rules do not have an enabled flag, once-only bit, or ordering key beyond
array order. A matching rule fires every evaluation pass until its `then`
is a no-op (same flag values already stored).

---

## Predicates

A `when` value is a single object with **one** recognised shape. Missing
flag == **false**. Unknown shapes fail validation at save; at eval they
are treated as false / skipped and logged.

### Atoms (rich — quest `when` only)

| Shape | True when |
|---|---|
| `{ "flag": "demo.x" }` | Stored value equals `true` (default `is`). |
| `{ "flag": "demo.x", "is": <value> }` | Stored value strictly equals `is`. `is` may be boolean, number, or string. |
| `{ "holds": 12 }` | Inventory contains artefact id `12`. |
| `{ "holdsTag": "key" }` | Some held artefact lists that tag. |
| `{ "hasBadge": "demo.winner" }` | Reader’s badge list includes that id. |
| `{ "atScene": 5 }` | Evaluation’s current scene id is `5`. |
| `{ "scenesOwned": { "gte": 5 } }` | Count of scenes with `owner` equal to this username is ≥ `gte`. |

`scenesOwned.gte` must be a number or the atom is false. Scene
create/delete is **not** an eval trigger; a threshold rule catches up on
the next [trigger](#evaluation-triggers).

`atScene` uses the scene id passed into that eval (see triggers). Visiting
`GET /s/:id` (teleport-by-URL) does **not** evaluate quests.

### Combinators

| Shape | True when |
|---|---|
| `{ "not": <pred> }` | Inner predicate is false. |
| `{ "all": [ … ] }` | Every element is true. Empty `all` is true. |
| `{ "any": [ … ] }` | At least one element is true. Empty `any` is false. |

Combinators nest freely. Example:

```json
{
  "all": [
    { "holds": 12 },
    { "not": { "flag": "demo.used" } },
    { "any": [{ "atScene": 5 }, { "atScene": 6 }] }
  ]
}
```

World gates on **exits, scene access, details, and artefacts** are a different
surface: a **FlagRef** string (`"flag.id"` or `"not.flag.id"`), not quest Pred.
They are not part of quest JSON. See [PUZZLES.md](PUZZLES.md#world-gates).

---

## Flag effects

Each `then` entry is exactly one of:

```json
{ "setFlag": "demo.hasKey", "to": true }
{ "setFlag": "demo.stage", "to": 2 }
{ "setFlag": "demo.mood", "to": "calm" }
{ "clearFlag": "demo.hasKey" }
```

| Field | Meaning |
|---|---|
| `setFlag` | Flag id in this quest’s namespace. |
| `to` | Optional. Boolean, number, or string. **Default `true`.** |
| `clearFlag` | Remove the key from the reader’s flag map. |

Setting a flag to the value it already has is a **no-op** (no `onFlag`).
`clearFlag` is a no-op if the key is already absent.

Stored values are JSON booleans, numbers, or strings. A missing key is
not `false`; predicates treat it as false, but `onFlag.onFalse` runs only
when the stored value **changes** to `false` or the key is cleared.

---

## `onFlag` knock-ons

```json
"onFlag": {
  "demo.done": {
    "onTrue": [
      { "grantBadge": "demo.winner" },
      { "giveArtefact": 99 }
    ],
    "onFalse": [
      { "grantBadge": "demo.unfinished" }
    ]
  }
}
```

Keys must be namespaced flag ids. Each value is an object:

| Field | Type | When it runs |
|---|---|---|
| `onTrue` | array of knock-ons | After a change whose new value is **not** `false` and **not** cleared (`true`, a number, or a string). |
| `onFalse` | array of knock-ons | After `clearFlag`, or `setFlag` with `"to": false`. |

Knock-ons run **once per actual transition**, not while the flag stays
put. Dropping a badge or uncollecting a granted artefact does **not**
re-grant until the flag goes away and comes back.

### Knock-on entries

| Shape | Effect |
|---|---|
| `{ "grantBadge": "demo.winner" }` | Append the id to the reader’s badge list if not already present. Id must be `name.*`. |
| `{ "giveArtefact": 99 }` | After eval, collect artefact `99` if it exists and is not already held. Must be a finite number. |

`giveArtefact` does **not** update inventory mid-cascade. A later rule in
the same eval cannot see the new artefact via `holds` / `holdsTag`. Flags
and badges granted in this eval **are** visible on later passes (badges
after the pass that triggered `onFlag`).

Missing artefact ids are skipped and logged; they do not fail the user
action.

---

## Badges

```json
{
  "id": "demo.winner",
  "title": "Winner",
  "description": "Optional profile blurb."
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `name.` + local part. |
| `title` | no | Profile label. Defaults to `id`. |
| `description` | no | Optional string. |

This array is catalogue copy. Granting still requires `onFlag` →
`grantBadge`. Readers see badges on **profile** and may drop them there;
flags stay invisible. Each **new** grant also delivers an inbox `notice`
from `Proseden` with subject `You've earned a badge <title>` and body set
to `description` when present (empty otherwise). Re-eval while the badge
is already held does not send another notice.

---

## Evaluation

### Triggers

Event-driven, per authenticated user. No timer.

| Event | `atScene` id used |
|---|---|
| Register / login | Resume scene (`lastSceneId` if still readable) |
| Successful **go** (`GET /s/:id/go/:exit`) | Destination after entrance-group resolve |
| Collect | Artefact’s home scene |
| Uncollect | `lastSceneId` |
| Successful alchemy combine | `lastSceneId` |
| Badge drop on profile | `lastSceneId` |

Not triggers: anonymous views, heartbeats, `GET /s/:id` teleport, scene
create/delete, manager JSON edits. Edits are **lazy** — each reader
catches up on their next trigger.

### Cascade

1. Sort loaded quests by `name` (`localeCompare`).
2. Repeat up to **16** passes:
   - For each quest, for each rule in file order: if `when` holds, apply
     `then`. Later rules in the same pass see updated flags.
   - If no flag values changed, stop.
   - For each change, look up `onFlag` on the quest whose `name` is the
     first dotted segment of the flag id (`demo.has` → quest `demo`). Run
     `onTrue` or `onFalse`.
3. Persist flags and badges. Send an inbox notice for each newly granted
   badge. Then collect any `giveArtefact` ids.

Faults (malformed `when`, missing artefacts, unexpected throws) are
logged as `[proseden:quest] …` and never fail login, go, collect, or
other user actions. A bad rule is skipped; other rules still run.

---

## Validation (save / load)

`parseQuestFile` throws `QuestValidationError` on:

- Non-object root
- `name` missing, empty after trim, or not a simple identifier
- `rules` not an array
- Rule not an object, missing `when`, or `then` missing / empty / not an array
- `then` entry that is not `setFlag` / `clearFlag`
- Flag, badge, or `onFlag` key not prefixed with `name.`
- `onFlag` not an object, or a handler not an object
- Knock-on that is not `grantBadge` / `giveArtefact`, or a non-finite artefact id
- `badges` not an array, or an entry not an object / missing namespaced `id`
- `when` not an object, `all`/`any` not arrays, or an unrecognised predicate key

Predicate **atom** fields are not type-checked beyond shape (`"flag" in
object`, etc.). A saved `{ "holds": "12" }` will not match inventory id
`12`.

---

## Worked examples

### Threshold badges (seed `builders`)

Rules only set flags from `scenesOwned`. Badges are granted when those
flags become true. Nothing runs at scene-create time; login, go, or
collect is enough to catch up.

```json
{
  "name": "builders",
  "title": "Builders",
  "description": "Threshold badges for scenes owned.",
  "rules": [
    {
      "id": "hamlet",
      "when": { "scenesOwned": { "gte": 5 } },
      "then": [{ "setFlag": "builders.hamlet", "to": true }]
    }
  ],
  "onFlag": {
    "builders.hamlet": { "onTrue": [{ "grantBadge": "builders.hamlet" }] }
  },
  "badges": [
    {
      "id": "builders.hamlet",
      "title": "Hamlet builder",
      "description": "Own 5 scenes."
    }
  ]
}
```

### Hold an artefact, then gate the world

Quest JSON only flips flags. An exit, scene access, or artefact `when` on the
**world record** is a FlagRef string (e.g. `"cellar.unlocked"` or
`"not.cellar.unlocked"`), not a quest Pred and not `holds`.

```json
{
  "name": "cellar",
  "title": "Cellar",
  "rules": [
    {
      "id": "key",
      "when": { "holds": 12 },
      "then": [{ "setFlag": "cellar.unlocked", "to": true }]
    },
    {
      "id": "no-key",
      "when": { "not": { "holds": 12 } },
      "then": [{ "clearFlag": "cellar.unlocked" }]
    }
  ],
  "onFlag": {
    "cellar.unlocked": {
      "onTrue": [{ "grantBadge": "cellar.keyholder" }]
    }
  },
  "badges": [{ "id": "cellar.keyholder", "title": "Keyholder" }]
}
```

With that, a scene exit and the destination scene may each use
`"when": "cellar.unlocked"` (set independently). Uncollecting the key clears
the flag on the next uncollect trigger, so the exit and room can close again.
The badge is **not** removed automatically;
the reader may drop it on profile. Re-collecting the key sets the flag
again and `onTrue` may fire once more.

### Chain flags in one eval

```json
{
  "name": "demo",
  "rules": [
    { "id": "a", "when": { "holds": 1 }, "then": [{ "setFlag": "demo.has" }] },
    { "id": "b", "when": { "flag": "demo.has" }, "then": [{ "setFlag": "demo.done" }] }
  ],
  "onFlag": {
    "demo.done": { "onTrue": [{ "grantBadge": "demo.winner" }] }
  },
  "badges": [{ "id": "demo.winner", "title": "Winner" }]
}
```

One collect of artefact `1` can set `demo.has`, then `demo.done` in a
later pass (or later in the same pass if `b` follows `a`), then grant
the badge when `demo.done` changes to true.

---

## Authoring notes

- Prefer `setFlag` defaults (`to` omitted ⇒ `true`) unless you need
  numbers or strings for staged flags.
- Keep local names unique within the quest (`demo.stage` not a second
  `demo.stage` with a different meaning).
- Do not put reader-facing story in `description`; put it in scene
  details gated by flags.
- Alchemy (`data/alchemy/recipes.json`) is a separate file and does not
  set flags. Notice a combine result with `{ "holds": <id> }` on a later
  trigger.
- The empty seed quest `proseden` exists so other files cannot claim
  `proseden.*`. Add platform marks there if needed.
