/**
 * Generator for samples/derelict — "Umbilical".
 * Idioms: O2 countdown + choking gates, on/gain contamination, scene when on return,
 * Input breaker swap, on:{flag} chain → giveArtefact, holdsTag EVA, Use patch,
 * Use dock-release to win at your airlock. No alchemy, no lamp-drain twin, no wait/season.
 *
 *   node scripts/build-derelict-sample.mjs
 */
import { prepareSampleRoot, writeWorld } from "./sample-world.mjs";

const scenes = [
  {
    id: 1,
    title: "Your Airlock",
    body: `Home metal. Your ship's collar still bites the derelict's ring. From here you can undock — if power, hull, and quarantine allow.

A stencil: **UMBRA-9 — do not linger.**`,
    details: {
      collar: "Green lights when the derelict's systems acknowledge release.",
      suit_rack: "Your spare gloves. The useful gear is aboard the hulk.",
    },
  },
  {
    id: 2,
    title: "Umbilical",
    body: `A short flex-tube between ships. Static ticks in your ear. Ahead: Umbra-9's receiving bay. Behind: the only way home.`,
    details: {
      hose: "Scuffed. Still holding pressure. For now.",
    },
  },
  {
    id: 3,
    title: "Receiving Bay",
    body: `Empty cradles and a welcome holoboard stuck on PLEASE WAIT. Dust floats where crew should be.`,
    details: {
      board: "Last update: *all hands to bio — containment*. Timestamp scrambled.",
      locker: "Magnetic boots tagged for hull walks. Take them if you mean to patch outside.",
    },
  },
  {
    id: 4,
    title: "Spine Corridor",
    body: `The ship's long bone. Sections branch to berths, galley, medbay, engineering, and the lab that should stay sealed.`,
    details: {
      signs: "Forward bridge. Aft engineering. Lab: AUTHORISED ONLY — ignored.",
      vents: "Air tastes thin when the scrubbers fail. Fix life support or choke.",
    },
  },
  {
    id: 5,
    title: "Crew Berths",
    body: `Curtained bunks. One diary slate still glows.`,
    details: {
      slate: "Engineering note: *if A trips, swap breaker A with C — not B. B is a decoy.*",
      bunk: "Cold blanket. No body.",
    },
  },
  {
    id: 6,
    title: "Galley",
    body: `Trays frozen mid-meal. A patch kit sits where a cook would never leave it — as if someone meant to return.`,
    details: {
      trays: "Coffee ice. Fork upright in something grey.",
    },
  },
  {
    id: 7,
    title: "Medbay",
    body: `A decon booth hums on standby. If you touched the lab's gift, this is where you wash it off before going home.`,
    details: {
      booth: "Use the decon cycle while standing here. Quarantine clears.",
      cabinet: "Empty antibiotics. Someone cleaned out hope.",
    },
  },
  {
    id: 8,
    title: "Bridge Blister",
    body: `Antechamber to the bridge. The hatch wants power and a chip the ship will only mint when breakers are honest.`,
    details: {
      hatch: "Dead bolts until engineering sings.",
    },
  },
  {
    id: 9,
    title: "Bridge",
    body: `Dead consoles in a horseshoe. One nav panel still asks for a release phrase from the old flight plan.`,
    details: {
      panel: "Prompt: ENTER DOCK MANTRA. A faded sticky: *umbra releases her children*.",
      view: "Your ship hangs like a remora outside the glass.",
    },
  },
  {
    id: 10,
    title: "Engineering",
    body: `Breaker panels and a smell of ozone. Someone labelled A, B, and C in three different handwritings.`,
    details: {
      panel: "A is tripped. B looks tempting. The berth slate said otherwise.",
      floor: "Scorch daisy.",
    },
  },
  {
    id: 11,
    title: "Reactor Catwalk",
    body: `A grated walk over a heart that still ticks. Without a tagged EVA layer, the rail alarms will not clear you through.`,
    details: {
      rail: "Alarm LEDs want something with tag *eva* held — boots count.",
      glow: "Too much blue.",
    },
  },
  {
    id: 12,
    title: "Life Support",
    body: `Scrubber drums and a red O₂ candle socket. This room decides how many breaths you have left aboard.`,
    details: {
      drums: "Filters clogged with grey fluff that might once have been moss.",
      socket: "Use an O₂ candle here to buy time.",
    },
  },
  {
    id: 13,
    title: "Cargo Hold",
    body: `Straps and crates. One crate cracked: sample vials labelled with a biohazard glyph that means *do not collect*.`,
    details: {
      crates: "Manifest: seed stock, machine parts, *specimen — cold*.",
    },
  },
  {
    id: 14,
    title: "Bio Lab",
    body: `Glass and frost. Something grew that should not have. A vial waits like an answer you will regret.`,
    details: {
      frost: "Handprints inside the glass. From the wrong side.",
      log: "Day 41: containment nominal. Day 42: we were wrong.",
    },
  },
  {
    id: 15,
    title: "Hull Breach Pocket",
    body: `Stars through a wound. Tape ghosts flutter. A proper patch kit used here will let the collar trust the hull again.`,
    details: {
      wound: "You can see your own ship. So close.",
      stars: "Indifferent.",
    },
  },
  {
    id: 16,
    title: "Outer Hull Walk",
    body: `Magnetic silence. The breach pocket yawns amidships. Boots keep you honest.`,
    details: {
      skin: "Micrometeor freckles.",
    },
  },
  {
    id: 17,
    title: "Spare Locker",
    body: `Foam cutouts. An O₂ candle and a data stub that never reached the bridge.`,
    details: {
      foam: "Missing tools. Present: breath and a stubborn stub.",
    },
  },
];

// choke gate helper text
const chokeDeep = {
  when: "flag:not.hull.choking",
  whenDenied: "Air is gone. Fall back to engineering and life support — burn an O₂ candle.",
};

const exits = {
  1: [["umbilical", 2]],
  2: [
    ["home", 1],
    ["bay", 3],
  ],
  3: [
    ["umbilical", 2],
    ["spine", 4],
  ],
  4: [
    ["bay", 3],
    ["berths", 5],
    ["galley", 6],
    ["medbay", 7],
    ["blister", 8, chokeDeep],
    ["engineering", 10],
    ["cargo", 13, chokeDeep],
    ["lab", 14, chokeDeep],
    ["locker", 17],
  ],
  5: [["spine", 4]],
  6: [["spine", 4]],
  7: [["spine", 4]],
  8: [
    ["spine", 4],
    [
      "bridge",
      9,
      {
        when: "flag:hull.powerOn,holds:9",
        whenDenied: "Needs power and the access chip engineering mints.",
      },
    ],
  ],
  9: [["blister", 8]],
  10: [
    ["spine", 4],
    [
      "reactor",
      11,
      {
        when: "holds:4",
        whenDenied: "Reactor rail wants magnetic boots held.",
      },
    ],
    ["life", 12],
  ],
  11: [
    ["engineering", 10],
    [
      "outer",
      16,
      {
        when: "holds:4",
        whenDenied: "No boots, no walk.",
      },
    ],
  ],
  12: [["engineering", 10]],
  13: [["spine", 4]],
  14: [["spine", 4]],
  15: [
    [
      "outer",
      16,
      {
        when: "holds:4",
        whenDenied: "Boots required.",
      },
    ],
  ],
  16: [
    ["reactor", 11],
    ["breach", 15],
  ],
  17: [["spine", 4]],
};

const artefacts = [
  {
    id: 1,
    homeSceneId: 6,
    title: "Hull patch kit",
    body: "Epoxy sausage and a plate. Use at the breach pocket.",
    tags: ["tool", "patch"],
  },
  {
    id: 2,
    homeSceneId: 17,
    title: "O₂ candle",
    body: "One-shot oxygen. Use in life support before the thin air wins.",
    tags: ["o2", "survival"],
  },
  {
    id: 3,
    homeSceneId: 14,
    title: "Specimen vial",
    body: "Cold to the touch. Collecting it marks you contaminated until medbay decon.",
    tags: ["bio", "sample"],
  },
  {
    id: 4,
    homeSceneId: 3,
    title: "Magnetic boots",
    body: "EVA soles. Hold them to walk reactor rails and outer skin.",
    tags: ["eva", "boots"],
  },
  {
    id: 5,
    homeSceneId: 17,
    title: "Data stub",
    body: "Dock mantra reminder: *umbra releases her children*. Use is optional — Input on the bridge is enough.",
    tags: ["data", "clue"],
  },
  {
    id: 6,
    homeSceneId: 1,
    title: "Dock release key",
    body: "Your ship's undock control. Use here when Umbra-9 is powered, patched, and you are clean.",
    tags: ["dock", "home"],
  },
  {
    id: 7,
    homeSceneId: 7,
    title: "Decon charge",
    body: "Booth catalyst. Use in medbay to clear quarantine.",
    tags: ["decon", "med"],
  },
  {
    id: 8,
    homeSceneId: 12,
    title: "Spare scrubber sock",
    body: "Flavour. The candle matters more.",
    tags: ["flavour"],
  },
  {
    id: 9,
    homeSceneId: 10,
    title: "Access chip",
    body: "Minted when breakers tell the truth. Opens the bridge with power.",
    tags: ["chip", "key"],
    when: "flag:hull._shelf",
  },
];

const quest = {
  name: "hull",
  title: "Umbilical",
  description:
    "Derelict sample. Idioms: O2 init/drain/choke, on/gain contamination, Input breaker, on/{flag}→giveArtefact, holds boots for EVA, Use patch, Use decon, Use dock-release win at airlock. No alchemy, no lamp twin, no wait/season.",
  rules: [
    {
      id: "o2-init",
      when: { all: [{ var: "hull.o2", "=": 0 }, { flag: "not.hull.breathing" }] },
      then: [{ setVar: "hull.o2", to: 14 }, { setFlag: "hull.breathing" }],
    },
    {
      id: "o2-drain",
      when: { all: [{ flag: "hull.breathing" }, { var: "hull.o2", ">": 0 }] },
      then: [{ decVar: "hull.o2" }],
    },
    {
      id: "o2-empty",
      when: {
        all: [{ flag: "hull.breathing" }, { var: "hull.o2", "<": 1 }, { flag: "not.hull.choking" }],
      },
      then: [{ setFlag: "hull.choking" }],
    },
    {
      id: "burn-candle",
      on: "use",
      when: { all: [{ use: 2 }, { atScene: 12 }] },
      then: [
        { setVar: "hull.o2", to: 18 },
        { clearFlag: "hull.choking" },
        { setFlag: "hull.candleUsed" },
      ],
      ok: "The candle blooms oxygen. Drums catch. You can move again.",
    },
    {
      id: "gain-contam",
      on: "gain",
      when: { gain: 3 },
      then: [{ setFlag: "hull.contaminated" }],
    },
    {
      id: "decon",
      on: "use",
      when: { all: [{ use: 7 }, { atScene: 7 }, { flag: "hull.contaminated" }] },
      then: [{ clearFlag: "hull.contaminated" }, { setFlag: "hull.cleaned" }],
      ok: "The booth screams UV. Quarantine clears. Home will take you back.",
    },
    {
      id: "breakers",
      on: "input",
      when: {
        all: [{ input: "swap a with c" }, { atScene: 10 }, { flag: "not.hull.powerOn" }],
      },
      then: [{ setFlag: "hull.powerOn" }],
      ok: "A and C trade places. Lights stagger up the spine. The ship notices.",
    },
    {
      id: "mint-chip",
      on: { flag: "hull.powerOn" },
      when: { flag: "not.hull.chipMinted" },
      then: [{ setFlag: "hull.chipMinted" }, { giveArtefact: 9 }],
    },
    {
      id: "patch-breach",
      on: "use",
      when: { all: [{ use: 1 }, { atScene: 15 }] },
      then: [{ setFlag: "hull.patched" }],
      ok: "Epoxy sets in vacuum's idea of a hurry. The collar may trust the hull.",
    },
    {
      id: "nav-mantra",
      on: "input",
      when: {
        all: [
          { input: "umbra releases her children" },
          { atScene: 9 },
          { flag: "not.hull.navOk" },
        ],
      },
      then: [{ setFlag: "hull.navOk" }],
      ok: "Nav accepts the mantra. Dock logic softens.",
    },
    {
      id: "ready-undock",
      when: {
        all: [
          { flag: "hull.powerOn" },
          { flag: "hull.patched" },
          { flag: "hull.navOk" },
          { flag: "not.hull.contaminated" },
          { flag: "not.hull.canUndock" },
        ],
      },
      then: [{ setFlag: "hull.canUndock" }],
    },
    {
      id: "undock",
      on: "use",
      when: {
        all: [
          { use: 6 },
          { atScene: 1 },
          { flag: "hull.canUndock" },
          { flag: "not.hull.escaped" },
        ],
      },
      then: [{ setFlag: "hull.escaped" }, { grantBadge: "hull.survivor" }],
      ok: "Collars part. Umbra-9 falls away. Your airlock is yours again.",
    },
    {
      id: "undock-blocked-contam",
      on: "use",
      when: {
        all: [{ use: 6 }, { atScene: 1 }, { flag: "hull.contaminated" }],
      },
      then: [{ setFlag: "hull.triedDirty" }],
      ok: "Your ship refuses the seal. Contaminated. Medbay decon first.",
    },
    {
      id: "undock-blocked-early",
      on: "use",
      when: {
        all: [
          { use: 6 },
          { atScene: 1 },
          { flag: "not.hull.canUndock" },
          { flag: "not.hull.contaminated" },
        ],
      },
      then: [{ setFlag: "hull.triedEarly" }],
      ok: "Release refuses. Need power, patched hull, nav mantra — and a clean bill.",
    },
  ],
  badges: [
    {
      id: "hull.survivor",
      title: "Umbilical severed",
      description: "Powered, patched, cleared quarantine, and undocked from Umbra-9.",
    },
  ],
  alchemy: [],
};

const readme = `# Umbilical (\`samples/derelict\`)

Original derelict-spacecraft sample. You dock, learn the crew is gone wrong, and must **return to your own airlock** alive.

**Different idioms from Night Briefing and Ashen Keep:**

| This sample | Others avoid overlapping |
|---|---|
| O₂ var init/drain → \`choking\` exit lockdown | Not lamp-drain; not soft late-shift flavour |
| \`on: "gain"\` contamination + medbay Use decon | Fantasy curse is mirror-specific; this is quarantine |
| Input breaker swap → \`on: { flag }\` → \`giveArtefact\` chip | No alchemy mint |
| \`holds:boots\` EVA gates (reactor/outer/breach) | Not dive-kit Use |
| Use patch at breach + Input nav mantra | Not safe code / rite words |
| Use dock-release **at your airlock** to win | Not hold-three / deliver-letter |
| No alchemy, no wait/season, no park/oak | — |

## Boot

\`\`\`bash
rm -rf /tmp/proseden-derelict-data
PROSEDEN_SEED=./samples/derelict PROSEDEN_DATA=/tmp/proseden-derelict-data npm start
\`\`\`

**admin** / **admin** — start in **Your Airlock**.

## Map

\`\`\`text
Your Airlock — Umbilical — Bay — Spine — Berths / Galley / Medbay / Lab / Cargo / Locker
                               |     |
                          Blister   Engineering — Life Support
                               |          |
                            Bridge    Reactor — Outer — Breach
\`\`\`

## Critical path (spoiler)

1. Bay: magnetic boots. Locker: O₂ candle (+ data stub clue). Galley: patch kit. Medbay: decon charge.
2. If air fails: life support → use candle (O₂ drains every wake).
3. Berths slate → engineering Input \`swap a with c\` → power + chip granted.
4. Boots → reactor → outer → breach → use patch kit.
5. Optional horror: lab vial contaminates; medbay use decon charge.
6. Bridge (power+chip): Input \`umbra releases her children\`.
7. Airlock: use dock release when powered, patched, nav ok, not contaminated → \`hull.survivor\`.

## Regenerate

\`\`\`bash
node scripts/build-derelict-sample.mjs
\`\`\`
`;

const root = await prepareSampleRoot("derelict");
await writeWorld(root, {
  scenes,
  exits,
  artefacts,
  quest,
  entranceGroup: {
    id: "1",
    title: "Umbra-9 docked",
    entranceSceneId: 1,
    sceneIds: scenes.map((s) => s.id),
  },
  meta: {
    nextSceneId: 18,
    nextArtefactId: 10,
    nextGroupId: 1,
    nextEntranceGroupId: 2,
    entranceSceneId: 1,
    schemaVersion: 6,
  },
  readme,
});
console.log("Wrote samples/derelict");
