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
  "Ordered recipes. Each needs id, inputs (2+ artefact ids and/or tags), and gives (artefact id or ids). First matching combine wins. Optional ok prose on success.";
