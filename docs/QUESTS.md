# Quest JSON

A **quest** is a named bundle of rules. Readers never start or finish it.
Rules watch what is true for a person (what they hold, where they are, flags,
vars, …) and can change that person’s flags, vars, badges, and inventory.

World prose — exits, details, scene locks — does not read the rule tree. It
checks a short [Condition string](PUZZLES.md#world-gates) instead (`demo.hasKey`,
`holds:12`, `badge:demo.x`, `var:demo.stage>1`, …).

This file matches `src/logic/quests.ts`, `src/logic/pred.ts`, and
`src/model/logic.ts`. Design notes: [PUZZLES.md](PUZZLES.md).

---

## Picture

```
something happens (login, go, use, collect, …)
        ↓
  one quest evaluation (rules in file order, once)
        ↓
  flags / vars / badges / inventory may change
        ↓
  later rules in the same evaluation see those changes
        ↓
  world Conditions (FlagRef) read the new state
```

There is **no cascade loop**. Order in the JSON is the order that matters.

---

## Who writes what

| Path | Who |
|---|---|
| `data/quests/<name>.json` | Managers — **Data → Quests** |
| `data/quests/users/<username>.json` | Questors — Edit toolbar **Quests** (`name` must be `user.<username>`); managers — same files under **Data → Quests** |
| `data/users/<username>.flags.json` | Engine — that reader’s flags; questors may also edit their own via **Quests → Flags editor** |
| `data/users/<username>.vars.json` | Engine — that reader’s numeric vars |
| `data/users/<username>.badges.json` | Engine — badges on their profile; questors may also edit their own via **Quests → Badges editor** |

`name` is the **write namespace**. Flags, badges, and vars you set must look like
`name.local` (for example `demo.hasKey`, or `user.raith.hamlet` for a personal
file). Manager files run before personal ones. Rules that fail to parse are
skipped (logged); leftover unknown keys such as old `onFlag` are ignored.

Seed: `builders` (scene-count badges) and empty `proseden` (reserves
`proseden.*`). Manager name `user` is reserved so personal `user.<username>.*`
namespaces cannot collide.

---

## File shape

```json
{
  "name": "demo",
  "title": "Demo quest",
  "description": "Manager notes only. Not shown to readers.",
  "rules": [],
  "badges": [],
  "alchemy": []
}
```

| Field | Meaning |
|---|---|
| `name` | Identifier and namespace. Manager: `/^[A-Za-z][A-Za-z0-9_-]*$/` (not `user`). Personal: `user.<username>`. |
| `title` / `description` | Optional labels for editors. |
| `rules` | May be empty (still reserves the prefix). |
| `badges` | Catalogue copy for the profile shelf. Granting needs a `grantBadge` in some rule’s `then`. |
| `alchemy` | Optional recipes for this quest (same shape as master alchemy). Merged into live combine after master recipes; ids become `<questName>/<id>`. Omit or `[]` when unused. |

---

## Rules

```json
{
  "id": "found-key",
  "when": { "holds": 12 },
  "then": [{ "setFlag": "demo.hasKey" }, { "grantBadge": "demo.keyholder" }]
}
```

| Field | Meaning |
|---|---|
| `id` | Optional; handy in logs. |
| `on` | When this rule is allowed to run. **Omit** for always. |
| `when` | Must be true for `then` to run. |
| `then` | Non-empty list of effects. |
| `ok` | Optional prose after a matching **use** or **input** (ignored otherwise). |

### `on` — eligibility

| Written | Runs when |
|---|---|
| *(omit)* | Every evaluation |
| `"use"` | This evaluation is Use of an artefact — `when` must include `{ "use": <id> }` |
| `"input"` | This evaluation is Input — `when` must include `{ "input": "…" }` |
| `"gain"` | That artefact is in this evaluation’s **gained set** — `when` must include `{ "gain": <id> }` |
| `"drop"` | That artefact is in this evaluation’s **dropped set** — `when` must include `{ "drop": <id> }` |
| `{ "flag": "demo.x" }` | Flag `demo.x` **became set earlier in this evaluation** |
| `{ "clearFlag": "demo.x" }` | Flag `demo.x` was **cleared earlier in this evaluation** |

Do not write `"on": "always"`. There is no “any use” — name the artefact or phrase.

**Gained set:** starts with the artefact if the player just **collected** it (or
alchemy gave it). Also grows mid-evaluation when a prior rule’s
`giveArtefact` actually adds something new. Put gain-reactions **after** the
granting rule in the list.

**Dropped set:** starts with the artefact if the player just dropped it.

---

## Predicates (`when`)

One object with one recognised shape. Nest with `all` / `any` / `not`.

| Shape | True when |
|---|---|
| `{ "flag": "demo.x" }` | Flag is set |
| `{ "flag": "not.demo.x" }` | Flag is clear |
| `{ "holds": 12 }` | Inventory has artefact 12 |
| `{ "holdsTag": "key" }` | Some held artefact has that tag |
| `{ "hasBadge": "demo.winner" }` | Badge list includes that id |
| `{ "atScene": 5 }` | This evaluation’s scene id is 5 |
| `{ "scenesOwned": 5 }` | Scenes owned by this username ≥ 5 |
| `{ "var": "demo.dust", "=": 1 }` | Var equals 1 (unset reads as **0**) |
| `{ "var": "demo.dust", "!=": 0 }` | Var is not 0 |
| `{ "var": "demo.dust", ">": 1 }` | Var strictly greater than 1 |
| `{ "var": "demo.dust", "<": 3 }` | Var strictly less than 3 |
| `{ "use": 12 }` | Use of artefact 12 (only on `on: "use"`) |
| `{ "input": "open sesame" }` | Input phrase matches after normalize (only on `on: "input"`) |
| `{ "gain": 12 }` | Artefact 12 is in the gained set (only on `on: "gain"`) |
| `{ "drop": 12 }` | Artefact 12 is in the dropped set (only on `on: "drop"`) |
| `{ "chance": 4 }` | True with probability **1/N** (4 → 25%; `1` always). Quest-only — not a world-gate scheme |

`use` / `input` / `gain` / `drop` atoms are only valid on matching `on` rules.

Randomness belongs in quest evaluation (`chance`, or `setVar` with `random` below). World
gates stay deterministic: roll into a flag/var under a guard, then gate with `flag:` /
`var:`.

---

## Effects (`then`)

| Effect | What it does |
|---|---|
| `{ "setFlag": "demo.x" }` | Set the flag (no-op if already set) |
| `{ "clearFlag": "demo.x" }` | Clear the flag (no-op if already clear) |
| `{ "setVar": "demo.dust", "to": 2 }` | Set a numeric var (no-op if already that value; unset ≡ 0; `to: 0` is stored) |
| `{ "setVar": "demo.rnd", "random": 50 }` | Set to a uniform integer **1..N** inclusive (re-rolls every time the rule fires; guard with `when` for a one-shot) |
| `{ "incVar": "demo.dust" }` | Add 1 to a var (unset starts at 0) |
| `{ "incVar": "demo.dust", "by": 3 }` | Add `by` (`by` must be > 0; default 1) |
| `{ "decVar": "demo.dust" }` | Subtract 1 from a var |
| `{ "decVar": "demo.dust", "by": 1 }` | Subtract `by` |
| `{ "clearVar": "demo.dust" }` | Remove the var key (no-op if already unset); reads still as 0 |
| `{ "grantBadge": "demo.winner" }` | Add badge if not already held |
| `{ "giveArtefact": 99 }` | Collect artefact 99 if not held (and it exists); counts as a **gain** for later rules |

Ids you write must stay under this quest’s `name.` prefix.

---

## Order

Rules run **once**, top to bottom, across quest files (managers first, then
personal), then within each file’s `rules` array.

- Put **A before B** if A should feed B in the **same** evaluation.
- For a shared use/input that should advance only **one** step per action, put
  the higher step **first** (so the lower step still matches this time, and
  the higher waits for the next action).

Example — wait twice to raise a stage:

```json
{
  "rules": [
    {
      "on": "input",
      "when": { "all": [{ "input": "wait" }, { "var": "demo.dust", "=": 1 }] },
      "then": [{ "setVar": "demo.dust", "to": 2 }]
    },
    {
      "on": "input",
      "when": { "all": [{ "input": "wait" }, { "var": "demo.dust", "=": 0 }] },
      "then": [{ "setVar": "demo.dust", "to": 1 }],
      "ok": "Dust has settled a little."
    }
  ]
}
```

---

## Vars and world gates

Vars are numbers only. Unset reads as **0**. Operators in Conditions are
strict `=` / `!=` / `<` / `>` (not ≤ / ≥):

- `var:demo.dust=1`
- `var:demo.dust!=0`
- `var:demo.dust>1` (stage 2 or beyond if stages are 0,1,2,…)
- `var:not.demo.dust=0` (invert, same `not.` idea as flags)

Flags remain the boolean bus for simple locks. Vars are for stages and other
ordered state (you’ll want comments in the quest file — there are no string
labels on the values).

---

## When evaluations run

Signed-in readers only. No timer.

| Event | Notes |
|---|---|
| Register / login | Always rules |
| Successful go | Always rules |
| Collect | Wake `gain` for that artefact |
| Drop from inventory | Wake `drop` for that artefact |
| Alchemy combine (new item) | Wake `gain` for new ids |
| Badge drop | Always rules |
| Use | Wake `use` |
| Input | Wake `input` on that scene |

Not wakes: anonymous views, heartbeats, teleport `GET /s/:id`, Live chat,
scene create/delete.

After Use or Input, the reader sees that rule’s `ok`, or **Done.**, or
**Nothing happens.** if no matching use/input rule fired.

---

## Example: builders (seed)

```json
{
  "when": { "all": [{ "scenesOwned": 5 }, { "flag": "not.builders.hamlet" }] },
  "then": [
    { "setFlag": "builders.hamlet" },
    { "grantBadge": "builders.hamlet" }
  ]
}
```

---

## Alchemy (optional on the quest)

Same recipe objects as master / user alchemy files. Prefer this when the
recipe belongs to the quest’s puzzle rather than the world-wide master list.

```json
{
  "id": "brew-tonic",
  "inputs": [12, { "tag": "herb" }],
  "gives": 99,
  "ok": "The tonic clarifies."
}
```

Live merge order for combine: master `alchemy/recipes.json`, then each loaded
quest’s `alchemy` (manager quests first, then personal), then
`alchemy/users/*.json`. Quest recipe ids are namespaced as
`<quest.name>/<id>` (for example `demo/brew-tonic` or `user.bob/brew-tonic`).

Personal quest alchemy uses the same home-scene manage ACL as `giveArtefact`
and user alchemy `gives`.

---

## Validation

On save, bad rules are rejected for the editor path; on load, bad rules are
skipped so the rest of the file still runs. Whole-file failures still apply
for a missing/invalid `name`, non-object JSON, or invalid `alchemy` array.
