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
  "description": "Flags and badges must use your username as prefix.",
  "rules": [
    {
      "id": "found-key",
      "when": { "holds": 12 },
      "then": [{ "setFlag": "YOUR_USERNAME.hasKey", "to": true }]
    }
  ],
  "onFlag": {
    "YOUR_USERNAME.hasKey": {
      "onTrue": [{ "grantBadge": "YOUR_USERNAME.keyholder" }]
    }
  },
  "badges": [
    {
      "id": "YOUR_USERNAME.keyholder",
      "title": "Keyholder",
      "description": "Found the key."
    }
  ]
}`;

export const QUEST_HELP =
  "One quest object. name must be your username (the write namespace for flags and badges). Manager quests are evaluated first; invalid or unauthorized personal quests are skipped at load. giveArtefact only for artefacts homed in scenes you own or manage. For an official named quest, ask a manager to register it under Data → Quests.";
