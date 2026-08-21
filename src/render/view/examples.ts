/** Shared JSON field examples for SSR and client editors. */

export const DETAILS_EXAMPLE = `{
  "card": "Closer look at the mantel card.
Second paragraph on a new line.",
  "window": "Rain beads on the glass."
}`;

export const GRANTS_EXAMPLE = `[
  { "who": "visitor", "rights": ["read"] },
  { "who": "*", "rights": ["read", "edit"] }
]`;

export const DENIES_EXAMPLE = `[
  { "who": "bob", "rights": ["edit"] },
  { "who": "carol" }
]`;

export const ALCHEMY_EXAMPLE = `[
  {
    "id": "sunset-cocktail",
    "inputs": [{ "tag": "spirit" }, { "tag": "citrus" }, 44],
    "gives": 120,
    "ok": "The glass blushes orange."
  },
  {
    "id": "key-ring",
    "inputs": [12, 13],
    "gives": [99, 100],
    "ok": "Two keys become a ring."
  }
]`;

export const ALCHEMY_HELP =
  "Ordered recipes. Each needs id, inputs (2+ artefact ids and/or tags), and gives (artefact id or ids). First matching combine wins. Optional ok prose on success. Master recipes are checked before user recipes.";

export const QUEST_EXAMPLE = `{
  "name": "YOUR_USERNAME",
  "title": "Your personal quests",
  "description": "Flags, badges, and vars use this quest name as prefix (personal: user.<username>). Rules run once top to bottom.",
  "rules": [
    {
      "id": "found-key",
      "when": { "holds": 12 },
      "then": [
        { "setFlag": "YOUR_USERNAME.hasKey" },
        { "grantBadge": "YOUR_USERNAME.keyholder" }
      ]
    },
    {
      "id": "use-key",
      "on": "use",
      "ok": "The lock yields.",
      "when": { "all": [{ "use": 12 }, { "atScene": 5 }] },
      "then": [{ "setFlag": "YOUR_USERNAME.unlocked" }]
    },
    {
      "id": "wait-once",
      "on": "input",
      "ok": "Dust settles a little.",
      "when": { "all": [{ "input": "wait" }, { "var": "YOUR_USERNAME.dust", "=": 0 }] },
      "then": [{ "setVar": "YOUR_USERNAME.dust", "to": 1 }]
    }
  ],
  "badges": [
    {
      "id": "YOUR_USERNAME.keyholder",
      "title": "Keyholder",
      "description": "Found the key."
    }
  ]
}`;

/** Shown in the quest JSON “i” hint (plain text; newlines preserved in the UI). */
export const QUEST_HELP = `One quest object. name is the write namespace for flags, badges, and vars. Personal files use user.<username>; manager files use a simple name (not "user"). Rules run once in document order each evaluation — later rules see earlier then effects. Omit on for always. Event ons need a matching when atom. Optional ok prose is for use/input only. Bad rules are skipped at load. giveArtefact only for artefacts you own or manage the home of.

on (eligibility — omit for always):
  "use" | "input" | "gain" | "drop"
  { "flag": "name.local" }          — became set earlier this evaluation
  { "clearFlag": "name.local" }     — cleared earlier this evaluation

when (one shape; nest with all / any / not):
  flag, holds, holdsTag, hasBadge, atScene, scenesOwned
  var (+ exactly one of "=", "!=", ">", "<")
  use, input, gain, drop            — only with matching on
  not, all, any

then (non-empty list):
  { "setFlag": "name.local" }
  { "clearFlag": "name.local" }
  { "setVar": "name.local", "to": N }
  { "grantBadge": "name.local" }
  { "giveArtefact": <artefactId> }

Unset vars read as 0. scenesOwned: N means ≥ N. World Conditions may use var:name.local=3 (and != / > / <).`;
