/**
 * Generator for samples/fantasy — "Ashen Keep".
 * Idioms: drop-offering, gain-curse, multi-site Input ritual, badge-as-key,
 * giveArtefact reward, tactile Input (no lamp), Use-to-deliver win.
 * Avoids briefing twins: no alchemy, no lamp-drain, no wait/season, no 3-hold win.
 *
 *   node scripts/build-fantasy-sample.mjs
 */
import { prepareSampleRoot, writeWorld } from "./sample-world.mjs";

const scenes = [
  {
    id: 1,
    title: "Misty Road",
    body: `Fog softens the ruts. A crooked bridge spans black water; beyond it, timber roofs and a keep that has forgotten its better name.

A milestone: **Ashen Keep — bring silver, leave curses.**`,
    details: {
      milestone: "Travellers deliver sealed words here. The road remembers messengers.",
      fog: "Wet leaf. Distant cookfire.",
    },
  },
  {
    id: 2,
    title: "Crooked Bridge",
    body: `Planks complain. Under the span, a trollish bulk waits for toll. Coin flashed is not enough — the toll must be *left*.`,
    details: {
      water: "Too still. Bubbles when you linger.",
      troll: "It watches your hands. Drop silver into the water if you would pass.",
      gone: "Only water. The far bank is ordinary mud.",
    },
    detailWhen: {
      troll: "flag:not.fey.trollPaid",
      gone: "flag:fey.trollPaid",
    },
  },
  {
    id: 3,
    title: "Village Green",
    body: `A mossy well, shuttered cottages, a herb-wife's hut, and a path into wolf country. The keep road begins at the far trees.`,
    details: {
      well: "Carved lip: *Name the keep.* The village still knows the old rite words.",
      notice: "Wolves favour the glade. A whistle may buy a gap — or leave them a meal.",
    },
  },
  {
    id: 4,
    title: "Herb Wife's Hut",
    body: `Drying racks and a sticky mortar. She is out; her salt crock and scrap of ballad are not.`,
    details: {
      ballad: "Sing the road song in the glade when eyes shine. Words: *the long way home*.",
      crock: "Coarse salt. For unclean mirrors and worse.",
    },
  },
  {
    id: 5,
    title: "Standing Stones",
    body: `Three menhirs lean together. Spirals drink the grey light. Curses come here to be broken; rites come here to be finished.`,
    details: {
      carving: "Third word of the keep-rite: *open the sky*. Also: shatter what watches you.",
      grass: "Trampled by boots and paws.",
    },
  },
  {
    id: 6,
    title: "Forest Path",
    body: `Pine and birch. Something dragged a haunch this way — or left one for the taking.`,
    details: {
      tracks: "Wolf. Fresh. A scrap of meat hangs on a thorn like bait.",
    },
  },
  {
    id: 7,
    title: "Wolf Glade",
    body: `An open bowl of grass. When the pack holds it, the keep road beyond is a dare. When they feed or flee a song, the road is only a road.`,
    details: {
      eyes: "Yellow watchers. The far exit is theirs until they are busy elsewhere.",
      quiet: "The pack is elsewhere. Go while the quiet lasts.",
    },
    detailWhen: {
      eyes: "flag:not.fey.wolvesClear",
      quiet: "flag:fey.wolvesClear",
    },
  },
  {
    id: 8,
    title: "Ruined Gatehouse",
    body: `Portcullis rusted half-up. Murder-holes stare at fog.`,
    details: {
      arms: "Banner: grey tower on black.",
    },
  },
  {
    id: 9,
    title: "Courtyard",
    body: `Weeds through flagstones. Chapel ruin, cellar mouth, great hall, tower stair — the tower door refuses the unanointed.`,
    details: {
      weeds: "Nightshade and dandelion.",
      towerdoor: "Marked with a circle of ash. It wants a rite-badge, not a key.",
    },
  },
  {
    id: 10,
    title: "Great Hall",
    body: `Overturned tables. A cold hearth. Above the high seat hangs a mirror that should not still be silver.`,
    details: {
      seat: "Carved wolves chase their tails.",
      mirror: "It watches back. Taking it is a choice with teeth.",
    },
  },
  {
    id: 11,
    title: "Chapel Ruin",
    body: `Roof open to weather. An altar holds a dull wand and the second word of the keep-rite.`,
    details: {
      altar: "Inscription: *bind the ward.* The wand is for hush, not harm.",
      pews: "Moss has better attendance.",
    },
  },
  {
    id: 12,
    title: "Cellar Mouth",
    body: `Steps into damp dark. No torch brackets remain — only a painted hand pointing along the wall.`,
    details: {
      paint: "A note in chalk: *feel along the wall* when the dark wins.",
    },
  },
  {
    id: 13,
    title: "Black Cellars",
    body: `Barrels and blindness. Sight will not find the niche — touch might, if you ask the stone correctly.`,
    details: {
      barrels: "Empty. Vinegar and regret.",
      seam: "Your fingers find a cold iron ring where eyes failed.",
    },
    detailWhen: {
      seam: "flag:fey.feltWall",
    },
  },
  {
    id: 14,
    title: "Oubliette Niche",
    body: `A forgotten hollow. Dust, a bone whistle, and a sealed letter in grey ribbon.`,
    details: {
      dust: "Small prints. Rat, or something that wishes it were.",
    },
  },
  {
    id: 15,
    title: "Tower Stair",
    body: `Spiral stone. The study door above only yields to those the rite has marked.`,
    details: {
      window: "A slit of grey sky.",
    },
    when: "badge:fey.anointed",
    whenDenied: "The tower will not admit you until the keep-rite is finished.",
  },
  {
    id: 16,
    title: "Wizard's Study",
    body: `Charts of disagreeing stars. An empty hook where a key once hung — the keep still owes it to the anointed.`,
    details: {
      charts: "Three hands arguing in margin ink.",
      hook: "Empty. The key arrives by rite, not by searching.",
    },
  },
  {
    id: 17,
    title: "Battlements",
    body: `Wind and broken teeth of stone. The misty road is a pale ribbon home.`,
    details: {
      view: "Bridge, green, glade, keep — the shape of your evening.",
    },
  },
  {
    id: 18,
    title: "Smokehouse Lean-to",
    body: `A village lean-to behind the green. A haunch hangs where wolves can smell it.`,
    details: {
      hook: "Take the haunch if you mean to bargain with the pack. Or leave it.",
    },
  },
];

const exits = {
  1: [["bridge", 2]],
  2: [
    ["road", 1],
    [
      "green",
      3,
      {
        when: "flag:fey.trollPaid",
        whenDenied: "The troll blocks the bank. Drop silver into the water.",
      },
    ],
  ],
  3: [
    ["bridge", 2],
    ["hut", 4],
    ["stones", 5],
    ["forest", 6],
    ["smokehouse", 18],
  ],
  4: [["green", 3]],
  5: [["green", 3]],
  6: [
    ["green", 3],
    ["glade", 7],
  ],
  7: [
    ["path", 6],
    [
      "keep",
      8,
      {
        when: "flag:fey.wolvesClear",
        whenDenied: "Wolves hold the far side. Feed them, whistle, or sing the road song.",
      },
    ],
  ],
  8: [
    ["glade", 7],
    ["court", 9],
  ],
  9: [
    ["gate", 8],
    ["hall", 10],
    ["chapel", 11],
    ["cellars", 12],
    [
      "tower",
      15,
      {
        when: "badge:fey.anointed",
        whenDenied: "Ash marks the door. Complete the keep-rite first.",
      },
    ],
  ],
  10: [["court", 9]],
  11: [["court", 9]],
  12: [
    ["court", 9],
    ["down", 13],
  ],
  13: [
    ["up", 12],
    [
      "niche",
      14,
      {
        when: "flag:fey.feltWall",
        hidden: true,
        whenDenied: "You need to feel along the wall — input the chalk's advice.",
      },
    ],
  ],
  14: [["back", 13]],
  15: [
    ["court", 9],
    ["study", 16],
    ["battlements", 17],
  ],
  16: [["stair", 15]],
  17: [["stair", 15]],
  18: [["green", 3]],
};

const artefacts = [
  {
    id: 1,
    homeSceneId: 3,
    title: "Silver coin",
    body: "A worn coin. The bridge troll wants it left in the water — not shown, left.",
    tags: ["silver", "toll"],
  },
  {
    id: 2,
    homeSceneId: 10,
    title: "Watching mirror",
    body: "Too bright for this ruin. Taking it invites a curse until the stones break its hold.",
    tags: ["mirror", "cursed"],
  },
  {
    id: 3,
    homeSceneId: 4,
    title: "Crock of salt",
    body: "Coarse cleansing salt. Useful against mirror-wrongness if the stones are far.",
    tags: ["salt", "cleanse"],
  },
  {
    id: 4,
    homeSceneId: 11,
    title: "Wand of hush",
    body: "Short yew. Not for wolves — for quieting a cursed glass if salt fails.",
    tags: ["wand", "magic"],
  },
  {
    id: 5,
    homeSceneId: 18,
    title: "Raw haunch",
    body: "Smoked poorly. Wolves will quarrel over it if you leave it in their glade.",
    tags: ["meat", "bait"],
  },
  {
    id: 6,
    homeSceneId: 14,
    title: "Bone whistle",
    body: "Thin and mean. A pack may chase the note instead of you.",
    tags: ["whistle"],
  },
  {
    id: 7,
    homeSceneId: 14,
    title: "Sealed letter",
    body: "Grey ribbon. Deliver it on the misty road — that is the messenger's end.",
    tags: ["letter", "quest"],
  },
  {
    id: 8,
    homeSceneId: 16,
    title: "Iron keep-key",
    body: "Heavy, old, and granted only to the anointed. Flavour for the shelf — the tower already knows you.",
    tags: ["key"],
    when: "flag:fey._shelf",
  },
];

const quest = {
  name: "fey",
  title: "Ashen Keep",
  description:
    "Fantasy sample. Idioms: on/drop toll, on/gain curse, Input ritual sites, badge gate, giveArtefact, tactile Input, Use-to-deliver win. No alchemy, no lamp, no wait/season.",
  rules: [
    {
      id: "drop-toll",
      on: "drop",
      when: { all: [{ drop: 1 }, { atScene: 2 }] },
      then: [{ setFlag: "fey.trollPaid" }],
      ok: "Silver vanishes into black water. The troll sinks satisfied. Cross.",
    },
    {
      id: "gain-curse",
      on: "gain",
      when: { gain: 2 },
      then: [{ setFlag: "fey.cursed" }],
    },
    {
      id: "curse-blocks-court-magic",
      when: {
        all: [{ flag: "fey.cursed" }, { flag: "not.fey.warned" }, { atScene: 9 }],
      },
      then: [{ setFlag: "fey.warned" }],
    },
    {
      id: "shatter-stones",
      on: "input",
      when: { all: [{ input: "shatter" }, { atScene: 5 }, { holds: 2 }, { flag: "fey.cursed" }] },
      then: [{ clearFlag: "fey.cursed" }, { setFlag: "fey.mirrorBroken" }],
      ok: "You name the break. The mirror's hold cracks. The curse lifts.",
    },
    {
      id: "salt-cleanse",
      on: "use",
      when: { all: [{ use: 3 }, { flag: "fey.cursed" }] },
      then: [{ clearFlag: "fey.cursed" }, { setFlag: "fey.mirrorBroken" }],
      ok: "Salt bites the glass-wrong. The watching stops.",
    },
    {
      id: "wand-cleanse",
      on: "use",
      when: { all: [{ use: 4 }, { flag: "fey.cursed" }] },
      then: [{ clearFlag: "fey.cursed" }, { setFlag: "fey.mirrorBroken" }],
      ok: "The wand of hush drinks the mirror's whisper. Quiet returns.",
    },
    {
      id: "drop-haunch",
      on: "drop",
      when: { all: [{ drop: 5 }, { atScene: 7 }] },
      then: [{ setFlag: "fey.wolvesClear" }],
      ok: "The pack falls on the haunch in a snarling knot. The keep road is briefly ignored.",
    },
    {
      id: "whistle-wolves",
      on: "use",
      when: { all: [{ use: 6 }, { atScene: 7 }] },
      then: [{ setFlag: "fey.wolvesClear" }],
      ok: "The bone note flees into the trees. So do the wolves.",
    },
    {
      id: "sing-glade",
      on: "input",
      when: { all: [{ input: "the long way home" }, { atScene: 7 }] },
      then: [{ setFlag: "fey.wolvesClear" }],
      ok: "The road song softens the glade. The pack melts into pine.",
    },
    {
      id: "rite-well",
      on: "input",
      when: {
        all: [{ input: "name the keep" }, { atScene: 3 }, { flag: "not.fey.riteWell" }],
      },
      then: [{ setFlag: "fey.riteWell" }],
      ok: "The well accepts the name. One third of the rite settles.",
    },
    {
      id: "rite-chapel",
      on: "input",
      when: {
        all: [{ input: "bind the ward" }, { atScene: 11 }, { flag: "not.fey.riteChapel" }],
      },
      then: [{ setFlag: "fey.riteChapel" }],
      ok: "The altar warmens under your palm. Two thirds.",
    },
    {
      id: "rite-stones",
      on: "input",
      when: {
        all: [{ input: "open the sky" }, { atScene: 5 }, { flag: "not.fey.riteStones" }],
      },
      then: [{ setFlag: "fey.riteStones" }],
      ok: "The menhirs answer. The rite is nearly whole.",
    },
    {
      id: "rite-complete",
      when: {
        all: [
          { flag: "fey.riteWell" },
          { flag: "fey.riteChapel" },
          { flag: "fey.riteStones" },
          { flag: "not.fey.anointed" },
        ],
      },
      then: [
        { setFlag: "fey.anointed" },
        { grantBadge: "fey.anointed" },
        { giveArtefact: 8 },
      ],
    },
    {
      id: "feel-wall",
      on: "input",
      when: { all: [{ input: "feel along the wall" }, { atScene: 13 }] },
      then: [{ setFlag: "fey.feltWall" }],
      ok: "Fingers find iron where eyes found only black. A niche waits.",
    },
    {
      id: "deliver-letter",
      on: "use",
      when: {
        all: [
          { use: 7 },
          { atScene: 1 },
          { flag: "not.fey.cursed" },
          { flag: "not.fey.delivered" },
        ],
      },
      then: [{ setFlag: "fey.delivered" }, { grantBadge: "fey.courier" }],
      ok: "You set the letter on the milestone. The misty road takes its due. You are finished.",
    },
  ],
  badges: [
    {
      id: "fey.anointed",
      title: "Anointed",
      description: "Completed the three-site keep-rite. The tower admits you.",
    },
    {
      id: "fey.courier",
      title: "Keep's courier",
      description: "Delivered the sealed letter to the misty road, uncursed.",
    },
  ],
  alchemy: [],
};

const readme = `# Ashen Keep (\`samples/fantasy\`)

Original fantasy sample. **Different idioms from Night Briefing** on purpose.

| This sample uses | Briefing uses instead |
|---|---|
| \`on: "drop"\` toll / bait | Collect + Use pass / kit |
| \`on: "gain"\` curse | Soft tick / late-shift |
| Multi-site Input rite → **badge-as-key** | Numeric safe Input |
| \`giveArtefact\` on rite complete | Alchemy 2→1 |
| Tactile Input in dark (\`feel along the wall\`) | Lamp var + drain |
| **Use letter on the road** to win | Hold three evidence items |
| No alchemy, no wait/season | Alchemy dive + park wait |

Monsters are **avoided** (drop bait, whistle, sing) — no combat.

## Boot

\`\`\`bash
rm -rf /tmp/proseden-fantasy-data
PROSEDEN_SEED=./samples/fantasy PROSEDEN_DATA=/tmp/proseden-fantasy-data npm start
\`\`\`

**admin** / **admin**

## Map

\`\`\`text
Misty Road — Bridge — Green — Hut / Stones / Smokehouse / Forest — Glade — Gate — Court
                                                                      |     |     |
                                                                 Cellars  Hall  Chapel
                                                                      |     |
                                                                   Niche  Tower (badge) — Study
\`\`\`

## Critical path (spoiler)

1. Drop silver coin on the bridge → green.
2. Optional: leave the watching mirror or cleanse (shatter at stones / salt / wand) before delivery.
3. Input rite words at well (\`name the keep\`), chapel (\`bind the ward\`), stones (\`open the sky\`) → badge + key.
4. Clear wolves: drop haunch in glade, use whistle, or input \`the long way home\`.
5. Cellars: input \`feel along the wall\` → niche → letter (+ whistle).
6. Tower with badge → flavour. Use letter on Misty Road while uncursed → \`fey.courier\`.

## Regenerate

\`\`\`bash
node scripts/build-fantasy-sample.mjs
\`\`\`
`;

const root = await prepareSampleRoot("fantasy");
await writeWorld(root, {
  scenes,
  exits,
  artefacts,
  quest,
  entranceGroup: {
    id: "1",
    title: "Ashen Keep grounds",
    entranceSceneId: 1,
    sceneIds: scenes.map((s) => s.id),
  },
  meta: {
    nextSceneId: 19,
    nextArtefactId: 9,
    nextGroupId: 1,
    nextEntranceGroupId: 2,
    entranceSceneId: 1,
    schemaVersion: 6,
  },
  readme,
});
console.log("Wrote samples/fantasy");
