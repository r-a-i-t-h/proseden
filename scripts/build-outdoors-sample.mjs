/**
 * Generator for samples/outdoors — "Pitch & Pine".
 * Showcases dynamic details + exits: pitched tent (detail+exit), bike tyre states,
 * fire/stew leftovers, woods loop vs vantage escape, energy tradeoffs.
 *
 *   node scripts/build-outdoors-sample.mjs
 */
import { prepareSampleRoot, writeWorld } from "./sample-world.mjs";

const scenes = [
  {
    id: 1,
    title: "Lane End",
    body: `The tarmac gives up. A wooden gate opens onto meadow. Your bicycle leans on the post — faithful, or flat, depending on the night.

Beyond the gate: grass, a flat shelf of ground that *wants* a tent, and the first dark of pines.`,
    details: {
      gate: "Private land, open to walkers who leave no trace.",
      bike_firm:
        "Tyres round and honest. Ready to carry a wiser rider home.",
      bike_flat:
        "Both tyres kiss the dirt. Someone visited while you slept — or the night did. The pump will cost you.",
    },
    detailWhen: {
      bike_firm: "flag:not.camp.tiresFlat",
      bike_flat: "flag:camp.tiresFlat",
    },
  },
  {
    id: 2,
    title: "Meadow Shelf",
    body: `A level patch of turf between brook-sound and tree-line. Guidebooks would call it a pitch: drained, wind-broken by a low bank, far enough from the oaks that a widow-maker will miss you.

This is where the tent belongs — once you have one.`,
    details: {
      shelf: "Scuffed earth from older camps. A ring of stones waits for fire.",
      tent_pitched:
        "Canvas taut, guy-lines singing faintly. The flap faces away from the prevailing damp. You can go in.",
      fire_cold: "Ash and hope. Nothing alight.",
      fire_lit: "A small, legal flame. Good for stew; bad for secrets.",
      stew_pot:
        "The pot still smells of berries and oats. Remains of a meal that meant progress.",
      snare_set:
        "A spiteful little noose in the grass by the bike-path — baited with a bright wrapper. For two-legged pests.",
      snare_sprung:
        "The snare is empty and twisted. Something yelped in the night and did not return.",
    },
    detailWhen: {
      tent_pitched: "flag:camp.tentUp",
      fire_cold: "flag:not.camp.fireLit",
      fire_lit: "flag:camp.fireLit",
      stew_pot: "flag:camp.stewEaten",
      snare_set: "flag:camp.trapArmed,flag:not.camp.trapSprung",
      snare_sprung: "flag:camp.trapSprung",
    },
  },
  {
    id: 3,
    title: "Inside the Tent",
    body: `Green light through canvas. The meadow's wind becomes a polite rumour. Sleeping here advances the night — and invites passengers.`,
    details: {
      floor: "Groundsheet over honest dirt.",
      seam: "A stitch you will pretend not to see.",
    },
  },
  {
    id: 4,
    title: "Brook Bend",
    body: `Clear water over brown stones. Reeds hold stringy treasures. Fish reconsider every shadow.`,
    details: {
      water: "Cold enough to wake the wrists.",
      reeds: "Cordage-quality stems if you are patient.",
    },
  },
  {
    id: 5,
    title: "Tall Oak",
    body: `One oak taller than its neighbours. From above, the woods might confess a way through. From below, the first branch is a denial.`,
    details: {
      trunk: "Bark like old maps. The lowest branch laughs at unassisted climbers.",
      aid: "Your rope-ladder bites the bark. The crown is thinkable.",
    },
    detailWhen: {
      aid: "flag:camp.ladderSet",
    },
  },
  {
    id: 6,
    title: "Oak Crown",
    body: `Wind and leaf-glitter. The meadow is a green coin. The pine-woods show a pale seam — a ridge path — that the ground refuses to admit until you have seen it.`,
    details: {
      seam: "West-southwest: a brighter corridor under the canopy. Remember it.",
      nest: "Empty. Something larger moved on.",
    },
  },
  {
    id: 7,
    title: "Pine Gloom",
    body: `Needles underfoot. Paths fork and forget themselves. Without a high look, every promising gap returns you here.`,
    details: {
      needles: "Soft and treacherous.",
      bear: "Breath like wet iron. A bear has opinions about your route.",
      clear: "The bear is gone — fleas have diplomacy other tools lack.",
    },
    detailWhen: {
      bear: "flag:camp.bearHere,flag:not.camp.bearGone",
      clear: "flag:camp.bearGone",
    },
  },
  {
    id: 8,
    title: "Needle Drift",
    body: `A shallow bowl of pine litter. Three ways look identical. The woods are circular until proven otherwise.`,
    details: {
      drift: "Your own bootprints, already confusing you.",
    },
  },
  {
    id: 9,
    title: "Resin Thick",
    body: `Sticky air. Another loop of the same argument the pines keep having with walkers.`,
    details: {
      resin: "Sweet and trapping.",
    },
  },
  {
    id: 10,
    title: "Ridge Path",
    body: `The seam from the crown made real: a pale track lifting toward open sky. The circular woods release you here — once you know to look.`,
    details: {
      sky: "More light than you have earned yet.",
    },
  },
  {
    id: 11,
    title: "Berry Bank",
    body: `Brambles in a south-facing tangle. Purple fruit, and a forgotten sheet snagged like a flag of poor planning.`,
    details: {
      brambles: "They take blood as tax.",
    },
  },
  {
    id: 12,
    title: "Stump Cache",
    body: `A hollow stump used by someone who believed in pockets. Sticks, a spark-stone, tweezers — the archaeology of almost-camping.`,
    details: {
      hollow: "Dry inside. Bless whoever stacked this.",
    },
  },
];

const exits = {
  1: [
    ["meadow", 2],
  ],
  2: [
    ["lane", 1],
    ["brook", 4],
    ["oak", 5],
    ["pines", 7],
    ["berries", 11],
    ["stump", 12],
    [
      "tent",
      3,
      {
        when: "flag:camp.tentUp",
        hidden: true,
        whenDenied: "Pitch a tent on this shelf first.",
      },
    ],
  ],
  3: [["out", 2]],
  4: [["meadow", 2]],
  5: [
    ["meadow", 2],
    [
      "up",
      6,
      {
        when: "flag:camp.ladderSet,var:camp.energy>1",
        whenDenied: "Need a rope-ladder set on the oak — and energy enough to climb (eat first if spent).",
      },
    ],
  ],
  6: [["down", 5]],
  7: [
    ["meadow", 2, { when: "flag:not.camp.bearHere;flag:camp.bearGone", whenDenied: "The bear fills the way back. Use a flea — or wait until it is gone." }],
    ["drift", 8],
    [
      "ridge",
      10,
      {
        when: "flag:camp.sawVantage,flag:not.camp.bearHere;flag:camp.sawVantage,flag:camp.bearGone",
        hidden: true,
        whenDenied: "Without the crown's seam, this gap is only more pine.",
      },
    ],
  ],
  8: [
    ["gloom", 7],
    ["thick", 9],
  ],
  9: [
    ["drift", 8],
    ["gloom", 7],
  ],
  10: [["gloom", 7]],
  11: [["meadow", 2]],
  12: [["meadow", 2]],
};

// Fix meadow return from pines when no bear yet - bearHere only after first night venture.
// when: not bearHere OR bearGone — FlagRef: flag:not.camp.bearHere;flag:camp.bearGone
// I used that. Good.

// Ridge when: need sawVantage AND (not bearHere OR bearGone)
// flag:camp.sawVantage,flag:not.camp.bearHere;flag:camp.sawVantage,flag:camp.bearGone
// Good.

const artefacts = [
  {
    id: 1,
    homeSceneId: 12,
    title: "Bundle of sticks",
    body: "Wrist-thick, dry enough. Tent bones — or fire food, not both from the same thought. These are for structure.",
    tags: ["sticks", "tent"],
  },
  {
    id: 2,
    homeSceneId: 4,
    title: "Reed cord",
    body: "Twisted reed fibre. String, if you are generous with the word.",
    tags: ["string", "tent"],
  },
  {
    id: 3,
    homeSceneId: 11,
    title: "Canvas sheet",
    body: "A forgotten tarp in the brambles. Smells of leaf-mould and optimism.",
    tags: ["sheet", "tent"],
  },
  {
    id: 4,
    homeSceneId: 12,
    title: "Unpitched tent",
    body: "Sticks, cord, and sheet persuaded into a portable shelter. Use it on the meadow shelf to pitch.",
    tags: ["tent", "kit"],
    when: "flag:camp._shelf",
  },
  {
    id: 5,
    homeSceneId: 3,
    title: "Sleeping bag",
    body: "Mummy-shaped. Use only inside the tent — sleep advances night, and fleas.",
    tags: ["sleep"],
  },
  {
    id: 6,
    homeSceneId: 12,
    title: "Tweezers",
    body: "For splinters and worse. Use when fleas have joined you — yields a flea of your own.",
    tags: ["tool"],
  },
  {
    id: 7,
    homeSceneId: 3,
    title: "Captured flea",
    body: "Indignant in a matchbox. Bears respect small humiliations. Use when a bear blocks the pines.",
    tags: ["flea", "fauna"],
    when: "flag:camp._shelf",
  },
  {
    id: 8,
    homeSceneId: 12,
    title: "Spark stone",
    body: "Flint-ish. Strike with tinder at the meadow ring.",
    tags: ["fire", "spark"],
  },
  {
    id: 9,
    homeSceneId: 11,
    title: "Dry tinder",
    body: "Birch curl and patience.",
    tags: ["fire", "tinder"],
  },
  {
    id: 10,
    homeSceneId: 12,
    title: "Fire kit",
    body: "Tinder married to spark. Use on the meadow shelf to wake the stone ring.",
    tags: ["fire", "kit"],
    when: "flag:camp._shelf",
  },
  {
    id: 11,
    homeSceneId: 11,
    title: "Handful of berries",
    body: "Tart. Better in a stew than alone.",
    tags: ["food", "berry"],
  },
  {
    id: 12,
    homeSceneId: 4,
    title: "Oat sachet",
    body: "Travel oats. Waiting for berries and flame.",
    tags: ["food", "oat"],
  },
  {
    id: 13,
    homeSceneId: 2,
    title: "Trail stew",
    body: "Berries and oats persuaded by fire. Use at the meadow while the fire lives — restores energy.",
    tags: ["food", "stew"],
    when: "flag:camp._shelf",
  },
  {
    id: 14,
    homeSceneId: 4,
    title: "Long vine",
    body: "Supple and rude. Half a rope-ladder.",
    tags: ["vine", "climb"],
  },
  {
    id: 15,
    homeSceneId: 12,
    title: "Short stake",
    body: "A peg with ambition. The other half of a rope-ladder.",
    tags: ["stake", "climb"],
  },
  {
    id: 16,
    homeSceneId: 12,
    title: "Rope-ladder",
    body: "Vine and stake in honest alliance. Use at the tall oak to set a climb.",
    tags: ["ladder", "climb"],
    when: "flag:camp._shelf",
  },
  {
    id: 17,
    homeSceneId: 1,
    title: "Bike pump",
    body: "Use at the lane when tyres are flat. It will empty you — eat before you climb.",
    tags: ["pump", "bike"],
  },
  {
    id: 18,
    homeSceneId: 12,
    title: "Bright wrapper",
    body: "Trash with purpose. Bait for a snare.",
    tags: ["bait", "trap"],
  },
  {
    id: 19,
    homeSceneId: 4,
    title: "Wire twist",
    body: "From an old fence. Snare material.",
    tags: ["wire", "trap"],
  },
  {
    id: 20,
    homeSceneId: 12,
    title: "Pest snare",
    body: "Wrapper and wire. Use on the meadow before sleep to discourage tyre-vampires.",
    tags: ["trap"],
    when: "flag:camp._shelf",
  },
  {
    id: 21,
    homeSceneId: 1,
    title: "Bicycle",
    body: "Your way home. Use at the lane when tyres are firm, the ridge is known, and you have eaten like someone who learned.",
    tags: ["bike"],
  },
];

const quest = {
  name: "camp",
  title: "Pitch & Pine",
  description:
    "Outdoors sample: alchemy kits, pitched tent detail+exit, sleep→fleas/miscreant, energy, dynamic bike/fire/stew details, woods loop vs vantage exit, flea vs bear. Transformation win via bicycle.",
  rules: [
    {
      id: "energy-init",
      when: { all: [{ var: "camp.energy", "=": 0 }, { flag: "not.camp.awake" }] },
      then: [{ setVar: "camp.energy", to: 2 }, { setFlag: "camp.awake" }],
    },
    {
      id: "pitch-tent",
      on: "use",
      when: { all: [{ use: 4 }, { atScene: 2 }] },
      then: [{ setFlag: "camp.tentUp" }],
      ok: "Poles bite turf, sheet tautens, the shelf becomes a camp. A tent detail — and a way in — appear.",
    },
    {
      id: "sleep",
      on: "use",
      when: { all: [{ use: 5 }, { atScene: 3 }] },
      then: [
        { incVar: "camp.night" },
        { setFlag: "camp.hasFleas" },
        { setFlag: "camp.slept" },
      ],
      ok: "You sleep. Night deepens. Something tiny celebrates on your ankles.",
    },
    {
      id: "night-mischief",
      on: { flag: "camp.slept" },
      when: {
        all: [
          { flag: "camp.slept" },
          { flag: "not.camp.nightResolved" },
          { flag: "not.camp.trapArmed" },
        ],
      },
      then: [
        { setFlag: "camp.tiresFlat" },
        { setFlag: "camp.nightResolved" },
        { clearFlag: "camp.slept" },
      ],
    },
    {
      id: "night-trap",
      on: { flag: "camp.slept" },
      when: {
        all: [
          { flag: "camp.slept" },
          { flag: "not.camp.nightResolved" },
          { flag: "camp.trapArmed" },
        ],
      },
      then: [
        { setFlag: "camp.trapSprung" },
        { setFlag: "camp.nightResolved" },
        { clearFlag: "camp.slept" },
        { clearFlag: "camp.trapArmed" },
      ],
    },
    {
      id: "tweezers",
      on: "use",
      when: { all: [{ use: 6 }, { flag: "camp.hasFleas" }] },
      then: [
        { clearFlag: "camp.hasFleas" },
        { giveArtefact: 7 },
        { setFlag: "camp.fleaCaught" },
      ],
      ok: "Tweezers close. The flea is yours — a diplomat in a matchbox.",
    },
    {
      id: "bear-arrives",
      when: {
        all: [
          { atScene: 7 },
          { var: "camp.night", ">": 0 },
          { flag: "not.camp.bearGone" },
          { flag: "not.camp.bearHere" },
        ],
      },
      then: [{ setFlag: "camp.bearHere" }],
    },
    {
      id: "flea-bear",
      on: "use",
      when: { all: [{ use: 7 }, { atScene: 7 }, { flag: "camp.bearHere" }] },
      then: [{ clearFlag: "camp.bearHere" }, { setFlag: "camp.bearGone" }],
      ok: "You introduce the flea. The bear reconsiders every life choice and leaves at speed.",
    },
    {
      id: "light-fire",
      on: "use",
      when: { all: [{ use: 10 }, { atScene: 2 }] },
      then: [{ setFlag: "camp.fireLit" }],
      ok: "Spark eats tinder. The stone ring becomes a fire — a detail with heat.",
    },
    {
      id: "eat-stew",
      on: "use",
      when: {
        all: [{ use: 13 }, { atScene: 2 }, { flag: "camp.fireLit" }],
      },
      then: [
        { setVar: "camp.energy", to: 3 },
        { setFlag: "camp.stewEaten" },
        { setFlag: "camp.fed" },
      ],
      ok: "Stew lands like courage. Energy returns. A pot detail remembers the meal.",
    },
    {
      id: "set-ladder",
      on: "use",
      when: {
        all: [{ use: 16 }, { atScene: 5 }, { var: "camp.energy", ">": 1 }],
      },
      then: [{ setFlag: "camp.ladderSet" }],
      ok: "The rope-ladder hugs the oak. Climb when you still have legs.",
    },
    {
      id: "set-ladder-tired",
      on: "use",
      when: {
        all: [{ use: 16 }, { atScene: 5 }, { var: "camp.energy", "<": 2 }],
      },
      then: [{ setFlag: "camp.triedClimbTired" }],
      ok: "You fumble the ladder against the bark and fail. Eat. Then try again.",
    },
    {
      id: "vantage",
      when: { all: [{ atScene: 6 }, { flag: "not.camp.sawVantage" }] },
      then: [{ setFlag: "camp.sawVantage" }],
    },
    {
      id: "arm-trap",
      on: "use",
      when: { all: [{ use: 20 }, { atScene: 2 }] },
      then: [{ setFlag: "camp.trapArmed" }],
      ok: "Snare set by the path. A detail of spite. Sleep safer.",
    },
    {
      id: "pump",
      on: "use",
      when: { all: [{ use: 17 }, { atScene: 1 }, { flag: "camp.tiresFlat" }] },
      then: [
        { clearFlag: "camp.tiresFlat" },
        { setVar: "camp.energy", to: 0 },
      ],
      ok: "Tyres rise; you fall inward. Energy gone. The bike detail firms up — you will need food before the oak.",
    },
    {
      id: "ride-home",
      on: "use",
      when: {
        all: [
          { use: 21 },
          { atScene: 1 },
          { flag: "not.camp.tiresFlat" },
          { flag: "camp.sawVantage" },
          { flag: "camp.fed" },
          { flag: "not.camp.home" },
        ],
      },
      then: [{ setFlag: "camp.home" }, { grantBadge: "camp.trailwise" }],
      ok: "You ride out less foolish than you arrived. The lane takes a different person home.",
    },
  ],
  badges: [
    {
      id: "camp.trailwise",
      title: "Trailwise",
      description: "Pitched, slept, read the woods from above, and rode home fed with firm tyres.",
    },
  ],
  alchemy: [
    {
      id: "make-tent",
      inputs: [1, 2, 3],
      gives: 4,
      ok: "Sticks, cord, and sheet become an unpitched tent.",
    },
    {
      id: "make-firekit",
      inputs: [8, 9],
      gives: 10,
      ok: "Spark and tinder agree to be a fire kit.",
    },
    {
      id: "make-stew",
      inputs: [11, 12],
      gives: 13,
      ok: "Berries and oats become trail stew — still needs fire to matter.",
    },
    {
      id: "make-ladder",
      inputs: [14, 15],
      gives: 16,
      ok: "Vine and stake become a rope-ladder.",
    },
    {
      id: "make-snare",
      inputs: [18, 19],
      gives: 20,
      ok: "Wrapper and wire become a pest snare.",
    },
  ],
};

const readme = `# Pitch & Pine (\`samples/outdoors\`)

A **great outdoors** sample built to showcase **dynamic details and exits**: the meadow shelf describes where to pitch; after pitching, the tent is both a **detail** and a **hidden exit**; the bike’s detail flips with tyre state; fire, stew pot, and snare appear as details when earned; the pine woods loop until a **vantage** unlocks a ridge exit.

Premise: arrive soft, leave **trailwise** — not a combat saga, a transformation through campcraft, pests, and reading the land.

## Boot

\`\`\`bash
rm -rf /tmp/proseden-outdoors-data
PROSEDEN_SEED=./samples/outdoors PROSEDEN_DATA=/tmp/proseden-outdoors-data npm start
\`\`\`

**admin** / **admin**

## Dynamic prose & exits (the point)

| State | What changes |
|------|----------------|
| Tent pitched | Detail \`tent_pitched\` + exit **tent** into scene 3 |
| Fire lit / stew eaten | Details \`fire_lit\`, \`stew_pot\` on the meadow |
| Snare armed / sprung | Details on the meadow |
| Tyres flat / firm | Details \`bike_flat\` / \`bike_firm\` at Lane End |
| Ladder on oak | Detail \`aid\`; exit **up** needs ladder + energy |
| Vantage seen | Hidden exit **ridge** from Pine Gloom |
| Bear present | Detail + blocks return until flea diplomacy |

## Energy & the miscreant

- Sleeping (bag **inside tent**) advances night and gives fleas; without a snare, tyres go flat.
- Arm snare on the meadow **before** sleep → miscreant scared, tyres stay firm.
- Pumping flat tyres sets energy to 0 — you must eat stew before setting/climbing the oak.
- So: scare the miscreant **or** spend a meal-cycle on the pump before the vantage climb.

## Critical path (spoiler)

1. Stump: sticks, spark, tweezers, stake, wrapper. Brook: reed cord, oats, vine, wire. Berries: sheet, tinder, berries.
2. Alchemy: tent (sticks+cord+sheet), fire kit, stew, rope-ladder, snare.
3. Meadow: use tent → enter tent; use fire kit; use stew (energy 3); use snare.
4. Tent: use sleeping bag → fleas; tweezers → captured flea.
5. (If no snare) Lane: use pump → firm tyres, energy 0 → eat again.
6. Oak: use rope-ladder (needs energy > 1) → up → crown (sets vantage).
7. Pines: bear after first night — use flea → ridge exit (needs vantage).
8. Lane: use bicycle when firm tyres + vantage + fed → badge \`camp.trailwise\`.

## Regenerate

\`\`\`bash
node scripts/build-outdoors-sample.mjs
\`\`\`
`;

const root = await prepareSampleRoot("outdoors");
await writeWorld(root, {
  scenes,
  exits,
  artefacts,
  quest,
  entranceGroup: {
    id: "1",
    title: "Pitch & Pine",
    entranceSceneId: 1,
    sceneIds: scenes.map((s) => s.id),
  },
  meta: {
    nextSceneId: 13,
    nextArtefactId: 22,
    nextGroupId: 1,
    nextEntranceGroupId: 2,
    entranceSceneId: 1,
    schemaVersion: 6,
  },
  readme,
});
console.log("Wrote samples/outdoors");
