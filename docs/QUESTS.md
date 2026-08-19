# Quest JSON

A **quest** is a named bundle of rules. It is not a mission: readers never
start or complete it. Rules watch live facts (inventory, location, badges,
ownership, Use, Input) and **only set or clear boolean flags**. When a flag
actually changes, `onFlag` may grant a badge or artefact. The prose world
never sees the rule tree — exits and details check a simpler
[FlagRef](PUZZLES.md#world-gates) string (`demo.hasKey`, `holds:12`,
`badge:demo.x`).

Design intent: [PUZZLES.md](PUZZLES.md). This file matches
`src/logic/quests.ts`, `src/logic/pred.ts`, and `src/model/logic.ts`.

---

## Picture

```
facts (holds, atScene, uses, input, …)
        ↓  when
   setFlag / clearFlag     ← the only `then`
        ↓
   per-reader flags (true / false / missing)
        ↓                  ↓
  world FlagRef         onFlag (badge / artefact)
```

Flags are **booleans**. Missing is treated as false in `when` and FlagRef.
There is no variable store, no numbers/strings in the flag file, and no
expression language. Stages are extra flags (`demo.sawA`, `demo.sawAthenB`).
New puzzle needs are a new named fact on `when` (like `scenesOwned`), not
`vars.foo += 1`.

---

## Who writes what

| Path | Who |
|---|---|
| `data/quests/<name>.json` | Managers — **Data → Quests** |
| `data/quests/users/<username>.json` | Hand-picked **questors** — Edit toolbar **Quests** (`name` must be their username) |
| `data/users/<username>.flags.json` | Engine — that reader’s flags (invisible) |
| `data/users/<username>.badges.json` | Engine — `{ badge, grantTime }` on profile |

Same split as alchemy: Data for the official set, toolbar for your personal
file. Alchemy is open to every signed-in user; questor is not.

`name` is the **write namespace**. Every flag, badge, and `onFlag` key must
be `name.` plus a local part (`demo.found`, never `other.found`). Manager
files are evaluated first. Invalid or unauthorized personal files are skipped
at load (`[proseden:quest] …`) and do not block others.

Seed: `builders` (scene-count badges) and empty `proseden` (reserves
`proseden.*`). The filename should match `name`; the loader uses `name` from
JSON. Extra JSON keys are ignored on parse and dropped on save.

---

## File shape

```json
{
  "name": "demo",
  "title": "Demo quest",
  "description": "Manager notes only. Not shown to readers.",
  "rules": [],
  "onFlag": {},
  "badges": []
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Identifier and namespace. `/^[A-Za-z][A-Za-z0-9_-]*$/`. |
| `title` | no | Display label. |
| `description` | no | Manager-facing notes. |
| `rules` | yes | May be empty (reserves the prefix). |
| `onFlag` | no | Flag id → knock-ons when that flag **changes**. |
| `badges` | no | Catalogue copy for the profile shelf. Granting still needs `onFlag`. |

---

## Rules

```json
{
  "id": "found-key",
  "when": { "holds": 12 },
  "then": [{ "setFlag": "demo.hasKey" }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | no | For logs. Default `rule-<index>`. |
| `on` | no | `always` (default, omit on disk), `use`, or `input`. |
| `when` | yes | One [predicate](#predicates). If true, `then` runs. |
| `then` | yes | Non-empty. Only `setFlag` / `clearFlag`. |
| `ok` | no | Prose shown after a matching Use or Input. Ignored on Always. |

`grantBadge` and `giveArtefact` belong on `onFlag`, not in `then`.

**Always** (omit `on`) runs on login, go, collect, uncollect, alchemy, badge
drop — and also during Use and Input, so threshold rules can catch up.

**Use** (`"on": "use"`) runs only on `POST /a/:id/use` (button next to Drop
while held; the artefact is not dropped). The rule’s `when` must include
`{ "uses": <that id> }`. `{ "atScene": N }` is `lastSceneId` (opening the
artefact page does not move you).

**Input** (`"on": "input"`) runs only on `POST /s/:id/input` (signed-in
phrase box on the scene — not Live chat). The rule’s `when` must include
`{ "input": "…" }`. Standing matches a successful scene GET (read, flag
gate, entrance group); submitting counts as being in that room.

A matching Use/Input `when` (even if `then` is already a no-op) shows that
rule’s `ok`, or **Done.** If no Use/Input rule matched: **Nothing happens.**
Wrong phrase and wrong room look the same. Always side effects do not change
that notice.

---

## Predicates

`when` is one object with **one** recognised shape. Combinators nest;
atoms do not grow arithmetic. Missing flag is false.

### Atoms (quest `when` only)

| Shape | True when |
|---|---|
| `{ "flag": "demo.x" }` | Stored value is `true`. |
| `{ "flag": "demo.x", "is": false }` | Stored value is `false` (not the same as missing). |
| `{ "holds": 12 }` | Inventory contains artefact `12`. |
| `{ "holdsTag": "key" }` | Some held artefact has that tag. |
| `{ "hasBadge": "demo.winner" }` | Badge list includes that id. |
| `{ "atScene": 5 }` | This eval’s scene id is `5`. |
| `{ "scenesOwned": { "gte": 5 } }` | Scenes owned by this username ≥ 5. |
| `{ "uses": 12 }` | This eval is Use of artefact `12`. **Only on `on: "use"`.** |
| `{ "input": "open sesame" }` | Phrase matches after [normalize](#input-phrases). **Only on `on: "input"`.** |

`uses` / `input` on an Always rule are rejected (so `{ "not": { "uses": 12 } }`
cannot become a tautology). `scenesOwned.gte` must be a number or the atom is
false. Scene create/delete is not a trigger; a threshold catches up later.

`GET /s/:id` teleport does not evaluate quests. `atScene` is whatever scene
id that eval was given (go destination, collect home, Input’s scene, Use’s
`lastSceneId`).

World records do **not** use this tree. Their Condition field is a FlagRef
(`demo.x`, `holds:12`, `badge:demo.x`). See
[PUZZLES.md](PUZZLES.md#world-gates). `holdsTag`, `atScene`, `scenesOwned`,
`uses`, and `input` stay quest-only.

### Combinators

| Shape | True when |
|---|---|
| `{ "not": <pred> }` | Inner is false. |
| `{ "all": [ … ] }` | Every element is true. Empty `all` is true. |
| `{ "any": [ … ] }` | At least one is true. Empty `any` is false. |

```json
{
  "all": [
    { "holds": 12 },
    { "not": { "flag": "demo.used" } },
    { "any": [{ "atScene": 5 }, { "atScene": 6 }] }
  ]
}
```

### Input phrases

Submitted `phrase` and the `{ "input": "…" }` literal are normalized the
same way: Unicode NFKC, trim, collapse internal whitespace to one space,
`toLocaleLowerCase("en-US")`. Empty after that is not a match (POST returns
400). Max raw POST length is 200. Live chat is not a trigger.

---

## Flag effects

```json
{ "setFlag": "demo.hasKey" }
{ "setFlag": "demo.hasKey", "to": true }
{ "setFlag": "demo.unlocked", "to": false }
{ "clearFlag": "demo.hasKey" }
```

`to` is optional boolean, default `true`. Same-value set and clearing an
absent key are no-ops (no `onFlag`). Prefer omitting `to`. Prefer omitting
`is` on `{ "flag": … }` unless you need stored-false vs missing.

On load, `*.flags.json` keeps only booleans; leftover numbers or strings are
dropped.

---

## `onFlag` and badges

```json
"onFlag": {
  "demo.done": {
    "onTrue": [{ "grantBadge": "demo.winner" }, { "giveArtefact": 99 }],
    "onFalse": [{ "grantBadge": "demo.unfinished" }]
  }
}
```

`onTrue` runs when the stored value **changes** to `true`. `onFalse` runs
when it changes to `false` or the key is cleared. Knock-ons run once per
transition. Dropping a badge or uncollecting a granted artefact does not
re-grant until the flag goes away and comes back.

| Knock-on | Effect |
|---|---|
| `{ "grantBadge": "demo.winner" }` | Append `{ "badge", "grantTime" }` if not already held. Id must be `name.*`. |
| `{ "giveArtefact": 99 }` | After eval, collect that artefact if it exists and is not held. |

`giveArtefact` does not update inventory mid-cascade (`holds` will not see
it until the next trigger). Flags and badges granted in this eval **are**
visible on later passes. Missing artefact ids are logged and skipped.

**Badges** in the file are catalogue copy (`id`, `title`, `description`).
Granting still requires `onFlag` → `grantBadge`. Readers see them on
profile (with grant time) and may drop them there. Each **new** grant also
sends an inbox notice from `Proseden`. Re-eval while already held does not
notice again or change `grantTime`.

---

## When eval runs

Authenticated readers only. No timer. Manager JSON edits are lazy — each
reader catches up on their next trigger.

| Event | `atScene` | Rules |
|---|---|---|
| Register / login | Resume `lastSceneId` if still readable | Always |
| Successful go | Destination after entrance-group resolve | Always |
| Collect | Artefact’s home scene | Always |
| Uncollect | `lastSceneId` | Always |
| Alchemy combine | `lastSceneId` | Always |
| Badge drop | `lastSceneId` | Always |
| Use | `lastSceneId` | Always + `on: "use"` |
| Input | That scene | Always + `on: "input"` |

Not triggers: anonymous views, heartbeats, `GET /s/:id` teleport, scene
create/delete, Live chat.

### Cascade

Loaded quests: manager files sorted by `name`, then personal files. Up to
**16** passes: each eligible rule in file order; later rules see updated
flags. If nothing changed, stop; else run `onFlag` for each change (quest
looked up from the first dotted segment of the flag id), then another pass.
Then persist flags/badges, send new-badge notices, then collect
`giveArtefact` ids.

Faults are logged as `[proseden:quest] …` and never fail the reader action.
A bad rule is skipped; others still run.

---

## Examples

### Threshold (seed `builders`)

Always rule. Scene create does not eval; login/go/collect is enough.

```json
{
  "name": "builders",
  "title": "Builders",
  "rules": [
    {
      "id": "hamlet",
      "when": { "scenesOwned": { "gte": 5 } },
      "then": [{ "setFlag": "builders.hamlet" }]
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

### Hold a key vs sticky unlock

Live possession on the world record — no quest needed, no badge:

```json
"when": "holds:12"
```

(`badge:demo.x` is the same idea.) For a **sticky** unlock or an `onFlag`
reward, mirror hold/drop into a flag:

```json
{
  "name": "cellar",
  "rules": [
    { "id": "key", "when": { "holds": 12 }, "then": [{ "setFlag": "cellar.unlocked" }] },
    { "id": "no-key", "when": { "not": { "holds": 12 } }, "then": [{ "clearFlag": "cellar.unlocked" }] }
  ],
  "onFlag": {
    "cellar.unlocked": { "onTrue": [{ "grantBadge": "cellar.keyholder" }] }
  },
  "badges": [{ "id": "cellar.keyholder", "title": "Keyholder" }]
}
```

Put `"when": "cellar.unlocked"` on the exit **and** the destination scene
(not auto-copied). Uncollect clears the flag on the next uncollect eval; the
badge stays until dropped on profile.

### Use and Input

```json
{
  "name": "cellar",
  "rules": [
    {
      "id": "key",
      "on": "use",
      "ok": "The lock yields.",
      "when": { "all": [{ "uses": 12 }, { "atScene": 5 }] },
      "then": [{ "setFlag": "cellar.unlocked" }]
    },
    {
      "id": "riddle",
      "on": "input",
      "ok": "The wall slides aside.",
      "when": { "all": [{ "input": "open sesame" }, { "atScene": 5 }] },
      "then": [{ "setFlag": "cellar.spoke" }]
    }
  ]
}
```

Use the key in scene 5, or type the phrase there. Chat does not count.

### Chain in one eval

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

One collect can set `demo.has`, then `demo.done` later in the same pass (or
the next), then grant the badge when `demo.done` becomes true.

---

## Authoring notes

- Reader-facing story goes in scene details gated by flags, not in
  `description`.
- Alchemy does not set flags; notice a combine with `{ "holds": <id> }`
  later.
- Empty seed quest `proseden` exists so other files cannot claim
  `proseden.*`.

---

## Validation

`parseQuestFile` throws `QuestValidationError` on: non-object root; bad or
missing `name`; `rules` not an array; rule missing `when` or empty `then`;
`then` that is not `setFlag`/`clearFlag` or non-boolean `to`; ids not
prefixed with `name.`; bad `onFlag` / knock-ons / `badges`; unknown `when`
shape; `all`/`any` not arrays; non-boolean `flag.is`; `on` not
always/use/input; `uses`/`input` on the wrong `on` or missing from a
use/input rule; bad `uses` id; empty `input` after normalize.

Other atom fields are not type-checked beyond shape. `{ "holds": "12" }`
will not match inventory id `12`.
