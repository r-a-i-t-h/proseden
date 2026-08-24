/**
 * One-shot generator for samples/briefing. Run from repo root:
 *   node scripts/build-briefing-sample.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "briefing");
const TS = "2026-08-24T16:00:00.000Z";
const owner = "admin";

function escapeHashLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("#") ? `\\${line}` : line))
    .join("\n");
}

function serializeProse(meta, body, details = {}) {
  const detailBlocks = Object.entries(details)
    .map(([slug, text]) => `## detail:${slug}\n${escapeHashLines(text.trim())}`)
    .join("\n\n");
  const content = [escapeHashLines(body.trim()), detailBlocks].filter(Boolean).join("\n\n");
  const cleanMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) cleanMeta[key] = value;
  }
  return matter.stringify(`${content}\n`, cleanMeta);
}

const scenes = [
  {
    id: 1,
    title: "Night Lobby",
    body: `The revolving door sighs shut behind you. Fluorescent tubes hum over a marble floor that still shows the day's shoe-polish tracks. A laminated board lists tonight's skeleton staff — mostly blank lines.

A brass plaque names this building: **Bureau of Domestic Quiet**, Floor G.`,
    details: {
      plaque:
        "Bureau of Domestic Quiet — visitors report to the Front Desk. After 21:00, use the Night Lobby as your only authorised entrance.",
      board:
        "Duty officer: — ; Archive: closed to public; Plant: on call. Someone has pencilled *check the park oak* in the margin.",
    },
    detailWhen: { board: "flag:spy.shiftLate" },
  },
  {
    id: 2,
    title: "Ground Corridor",
    body: `Linoleum, noticeboards, and the smell of institutional coffee. Numbered doors run east and west. A card-reader blinks beside a grilled gate marked EVIDENCE.`,
    details: {
      notices:
        "Fire drill Wednesday. Do not prop the archive fire door. Lost property lives in the Night Canteen.",
      reader: "Red LED. It wants a pass held to the glass — not waved, held.",
    },
  },
  {
    id: 3,
    title: "Front Desk",
    body: `A high counter, a silent telephone, and a tray of visitor lanyards. The night clerk's chair is empty; a half-finished crossword sits under the blotter.`,
    details: {
      crossword: "Across: 'seasonal wait' (4). Down: already filled as WAIT.",
      blotter: "Ink rings and a scribble: *safe = month digits?*",
    },
  },
  {
    id: 4,
    title: "Records Office",
    body: `Filing cabinets in parade order. A single desk lamp pools light on an open folder. The rest of the room keeps its secrets in manila.`,
    details: {
      cabinets: "Personnel, Procurement, Quiet Complaints. One drawer is labelled *Memos — do not file*.",
    },
  },
  {
    id: 5,
    title: "Secretary Annexe",
    body: `A smaller desk, a calendar stuck on October, and a mug that reads WORLD'S SECOND-BEST TYPIST. The director's door stands opposite.`,
    details: {
      calendar: "October. A circle around the 3rd — and a faint 7, 1, 9 under it in pencil.",
      mug: "Chip on the rim. Cold tea.",
    },
  },
  {
    id: 6,
    title: "Director's Office",
    body: `Mahogany, a closed laptop, and a wall safe pretending to be a landscape. The carpet remembers heavier footsteps than yours.`,
    details: {
      safe: "Four-digit dial. The painting above it is a bland harbour — no help.",
      laptop: "Passworded. Not your problem tonight.",
    },
  },
  {
    id: 7,
    title: "Archive Landing",
    body: `Concrete stairs down. A stencil warns AUTHORISED STAFF ONLY. The air from below is colder, with a mineral damp.`,
    details: {
      stencil: "Authorised staff only. Torches provided from Plant.",
    },
  },
  {
    id: 8,
    title: "Archive Stacks",
    body: `Rows of shelves vanish into gloom. Without a beam you would walk into steel. Water stains climb the lower stacks like tide marks.`,
    details: {
      aisle:
        "Aisle C — Flood Contingency. An arrow points further down, toward a door that should not exist at basement level.",
      stains: "Old floods. Someone has chalked *bring kit* on a shelf edge.",
    },
    detailWhen: {
      aisle: "var:spy.lamp>0",
      stains: "var:spy.lamp>0",
    },
  },
  {
    id: 9,
    title: "Flooded Sub-basement",
    body: `Knee-deep water over tile. Pipes drip. A service hatch sits half-submerged in the far wall — swimming gear required, not courage alone.`,
    details: {
      hatch:
        "Beyond the hatch the water deepens. With a proper mask and snorkel you could follow the pipe run.",
      pipes: "Municipal cold feed. One flange weeps steadily.",
    },
    detailWhen: {
      hatch: "flag:spy.readyToDive",
    },
  },
  {
    id: 10,
    title: "Under-cistern",
    body: `A brick chamber under the building's cistern. Your light catches a wire basket wedged above the waterline — someone's emergency stash.`,
    details: {
      basket: "Rust and nylon. Something notebook-shaped rests inside.",
      brick: "Victorian. Initials carved: BDQ 1891.",
    },
  },
  {
    id: 11,
    title: "Plant Room",
    body: `Boilers, fuse boards, and a pegboard of tools. A welding mask hangs beside a coil of hose. A torch charger blinks green.`,
    details: {
      pegboard: "Spanners, tape, one empty hook labelled TORCH.",
      fuse: "Circuits labelled Lobby / Archive / Roof. Archive is on.",
    },
  },
  {
    id: 12,
    title: "Roof Stair",
    body: `A narrow stair with a metal handrail cold enough to bite. The door at the top has a crash-bar.`,
    details: {
      rail: "Paint worn to steel at the turns.",
    },
  },
  {
    id: 13,
    title: "Flat Roof",
    body: `Gravel, vents, and a city haze. You can see the courtyard oak's crown and the lane behind the Bureau.`,
    details: {
      vents: "Warm air. No secrets — only lunch smells from the canteen.",
      view: "The oak still holds its leaves. For now.",
    },
  },
  {
    id: 14,
    title: "Service Yard",
    body: `Bins, a loading bay, and a wooden ladder left against the wall as if someone meant to put it away.`,
    details: {
      bins: "Nothing useful. A shredded envelope marked CONFIDENTIAL.",
    },
  },
  {
    id: 15,
    title: "Courtyard Park",
    body: `A pocket of grass behind the Bureau. One old oak dominates. Benches face nothing in particular. Time feels optional here — if you wait.`,
    details: {
      bench: "Plaque: *In memory of quiet evenings.*",
      canopy: "Full summer green.",
      canopy_thin: "Leaves thinning. Something pale shows in the fork of a branch.",
      canopy_bare: "Most leaves down. A dark canister is obvious in the branches — too high to reach without help.",
    },
    detailWhen: {
      canopy: "var:spy.season=0",
      canopy_thin: "var:spy.season=1",
      canopy_bare: "var:spy.season>1",
    },
  },
  {
    id: 16,
    title: "The Old Oak",
    body: `Close under the oak. Bark, moss, and the smell of leaf-mould. The lowest branches are still a stretch without a ladder.`,
    details: {
      bark: "Old lightning scar. Initials long since grown over.",
      fork: "With leaves gone, a microfilm canister winks from the fork.",
    },
    detailWhen: {
      fork: "flag:spy.leavesFallen",
    },
  },
  {
    id: 17,
    title: "Among the Branches",
    body: `You are up in the oak, ladder steady against the trunk. Twigs catch your sleeves. The canister sits in the fork as if filed there.`,
    details: {
      fork: "Exactly the right size for a film can. Someone climbed here before you.",
    },
  },
  {
    id: 18,
    title: "Communications Closet",
    body: `Racks of quiet equipment, a wall phone, and a spool of tape left threaded on a desk recorder.`,
    details: {
      recorder:
        "The tape is mid-erase — a soft hiss. If you had arrived earlier, there might have been voices.",
      recorder_late:
        "The tape is blank. Only erase hiss. Whatever was said is gone with the late shift.",
      phone: "Internal only. Dial tone, then silence.",
    },
    detailWhen: {
      recorder: "flag:not.spy.shiftLate",
      recorder_late: "flag:spy.shiftLate",
    },
  },
  {
    id: 19,
    title: "Night Canteen",
    body: `Stacked chairs, a shuttered servery, and a lost-property crate under the window. Someone left a ridiculous coat.`,
    details: {
      crate: "Umbrella, one glove, and a glossy snorkel parka tagged *found — roof drain*.",
      menu: "Yesterday's shepherd's pie. Tea 40p.",
    },
  },
  {
    id: 20,
    title: "Evidence Cage",
    body: `Wire mesh and padlocked shelves. Tonight the padlock hangs open — someone expected a visitor with the right pass.`,
    details: {
      shelves: "Tagged bags, most routine. One empty hook labelled *film — see park*.",
      ledger: "Sign-out sheet. Last entry unsigned.",
    },
  },
];

const exits = {
  1: [
    ["corridor", 2],
    ["desk", 3],
    ["park", 15],
  ],
  2: [
    ["lobby", 1],
    ["desk", 3],
    ["records", 4],
    ["annexe", 5],
    ["archive", 7],
    ["plant", 11],
    ["roof", 12],
    ["canteen", 19],
    ["yard", 14],
    ["comms", 18],
    ["evidence", 20, { when: "flag:spy.passAccepted", hidden: true }],
  ],
  3: [
    ["lobby", 1],
    ["corridor", 2],
  ],
  4: [
    ["corridor", 2],
  ],
  5: [
    ["corridor", 2],
    ["director", 6],
  ],
  6: [
    ["annexe", 5],
  ],
  7: [
    ["corridor", 2],
    ["stacks", 8],
  ],
  8: [
    ["landing", 7],
    ["down", 9, { when: "var:spy.lamp>0", whenDenied: "Too dark to find the lower door safely." }],
  ],
  9: [
    ["stacks", 8],
    ["hatch", 10, { when: "flag:spy.readyToDive", hidden: true, whenDenied: "You need proper dive kit before that hatch is more than a rumour." }],
  ],
  10: [
    ["back", 9],
  ],
  11: [
    ["corridor", 2],
  ],
  12: [
    ["corridor", 2],
    ["roof", 13],
  ],
  13: [
    ["stair", 12],
  ],
  14: [
    ["corridor", 2],
    ["park", 15],
  ],
  15: [
    ["lobby", 1],
    ["yard", 14],
    ["oak", 16],
  ],
  16: [
    ["park", 15],
    ["up", 17, { when: "flag:spy.upTree", hidden: true, whenDenied: "Too high without a ladder — and clearer with the leaves gone." }],
  ],
  17: [
    ["down", 16],
  ],
  18: [
    ["corridor", 2],
  ],
  19: [
    ["corridor", 2],
  ],
  20: [
    ["corridor", 2],
  ],
};

const artefacts = [
  {
    id: 1,
    homeSceneId: 3,
    title: "Visitor pass",
    body: "A plastic lanyard with today's date. The photo is a grey silhouette — temporary issue.",
    tags: ["pass", "badge"],
    details: { back: "Hold to reader. Do not laminate." },
  },
  {
    id: 2,
    homeSceneId: 4,
    title: "Cryptic memo",
    body: "A half-sheet from the secretary's pad. It reads: *Combination — see calendar. Three, then the rest as pencilled.*",
    tags: ["memo", "clue"],
    details: { margin: "Someone underlined *calendar* twice." },
  },
  {
    id: 3,
    homeSceneId: 11,
    title: "Pocket torch",
    body: "Rubber grip, fresh batteries in the charger tray. Beam is sharp enough for stacks.",
    tags: ["torch", "lamp", "light"],
    details: { switch: "Click once for on. Use it when the dark presses in." },
  },
  {
    id: 4,
    homeSceneId: 19,
    title: "Snorkel parka",
    body: "A waterproof coat with an integrated snorkel hood — absurd for an office, perfect for a joke about drains.",
    tags: ["coat", "snorkel", "gear"],
    details: { tag: "Found — roof drain. Return to Plant." },
  },
  {
    id: 5,
    homeSceneId: 11,
    title: "Welding mask",
    body: "Dark glass, scuffed shell. Not for arc work tonight — for seeing through glare and spray.",
    tags: ["mask", "gear"],
    details: { glass: "Tinted. You could almost call it a welding mask for underwater light." },
  },
  {
    id: 6,
    homeSceneId: 11,
    title: "Dive kit",
    body: "Parka snorkel married to welding glass — improvised, sealed with tape and optimism. Good enough for a short hatch swim.",
    tags: ["dive", "kit", "gear"],
    when: "flag:spy._shelf",
    details: { seal: "Tape holds. Do not dive deep." },
  },
  {
    id: 7,
    homeSceneId: 14,
    title: "Wooden ladder",
    body: "Six rungs, paint spatters, sound joints. Meant for changing bulbs — tall enough for the oak.",
    tags: ["ladder", "tool"],
    details: { rung: "Third rung cracked but serviceable." },
  },
  {
    id: 8,
    homeSceneId: 17,
    title: "Microfilm canister",
    body: "A black film can, cold from the open air. Label: *quiet complaints — copy*.",
    tags: ["evidence", "film"],
    details: { label: "Not for the open shelves." },
  },
  {
    id: 9,
    homeSceneId: 10,
    title: "Wet notebook",
    body: "A field notebook in a zip bag. Pages list drop times and a foreign telex handle. Evidence.",
    tags: ["evidence", "notes"],
    details: { page: "Partial name. Enough for a briefing." },
  },
  {
    id: 10,
    homeSceneId: 6,
    title: "Clearance chit",
    body: "Bureau letterhead authorising collection of quiet-complaint copies after hours.",
    tags: ["evidence", "chit"],
    when: "flag:spy.safeOpen",
    details: { stamp: "Director's stamp, slightly smudged." },
  },
  {
    id: 11,
    homeSceneId: 20,
    title: "Empty film hook tag",
    body: "A cardboard tag from the evidence cage: *film — see park*. Someone already moved the contents.",
    tags: ["clue"],
    details: { back: "Initials BDQ." },
  },
];

let exitId = 1;
function buildExits(list) {
  return list.map(([nickname, toSceneId, opts = {}]) => {
    const rec = {
      exitId: exitId++,
      nickname,
      toSceneId,
      createdAt: TS,
    };
    if (opts.when) rec.when = opts.when;
    if (opts.whenDenied) rec.whenDenied = opts.whenDenied;
    if (opts.hidden) rec.hidden = true;
    return rec;
  });
}

const quest = {
  name: "spy",
  title: "Night Briefing",
  description:
    "Sample spy-HQ adventure for samples/briefing. Soft ticks, lamp drain, wait/season, alchemy dive kit, pass/safe/ladder gates. Not a port of any commercial game.",
  rules: [
    {
      id: "tick",
      when: { scenesOwned: 0 },
      then: [{ incVar: "spy.tick" }],
    },
    {
      id: "lamp-drain",
      when: { var: "spy.lamp", ">": 0 },
      then: [{ decVar: "spy.lamp" }],
    },
    {
      id: "shift-late",
      when: { all: [{ var: "spy.tick", ">": 24 }, { flag: "not.spy.shiftLate" }] },
      then: [{ setFlag: "spy.shiftLate" }],
    },
    {
      id: "torch-on",
      on: "use",
      when: { use: 3 },
      then: [{ setVar: "spy.lamp", to: 12 }],
      ok: "The torch throws a clean white cone. The charge will not last forever.",
    },
    {
      id: "pass-reader",
      on: "use",
      when: { all: [{ use: 1 }, { atScene: 2 }] },
      then: [{ setFlag: "spy.passAccepted" }],
      ok: "The reader chirps. The evidence gate unlatches with a tired click.",
    },
    {
      id: "safe-combo",
      on: "input",
      when: { all: [{ input: "3719" }, { atScene: 6 }] },
      then: [{ setFlag: "spy.safeOpen" }],
      ok: "The safe dials home. Inside: a clearance chit.",
    },
    {
      id: "wait-season-held",
      on: "input",
      when: { all: [{ input: "wait" }, { atScene: 15 }, { var: "spy.season", "=": 2 }] },
      then: [{ setVar: "spy.season", to: 2 }],
      ok: "The park holds. The canister is still up there.",
    },
    {
      id: "wait-season-2",
      on: "input",
      when: { all: [{ input: "wait" }, { atScene: 15 }, { var: "spy.season", "=": 1 }] },
      then: [{ setVar: "spy.season", to: 2 }, { setFlag: "spy.leavesFallen" }],
      ok: "Leaves carpet the grass. Something dark sits obvious in the oak's fork.",
    },
    {
      id: "wait-season-1",
      on: "input",
      when: { all: [{ input: "wait" }, { atScene: 15 }, { var: "spy.season", "=": 0 }] },
      then: [{ setVar: "spy.season", to: 1 }],
      ok: "A breeze. The canopy thins. Time is being unreasonable — and useful.",
    },
    {
      id: "ladder-oak",
      on: "use",
      when: {
        all: [{ use: 7 }, { atScene: 16 }, { flag: "spy.leavesFallen" }],
      },
      then: [{ setFlag: "spy.upTree" }],
      ok: "The ladder bites bark. You can climb to the fork.",
    },
    {
      id: "ladder-oak-early",
      on: "use",
      when: {
        all: [{ use: 7 }, { atScene: 16 }, { flag: "not.spy.leavesFallen" }],
      },
      then: [{ setFlag: "spy.triedLadderEarly" }],
      ok: "Leaves still hide the fork. You could climb — but you would find only green. Wait in the park until the canopy thins.",
    },
    {
      id: "dive-ready",
      on: "use",
      when: { all: [{ use: 6 }, { atScene: 9 }] },
      then: [{ setFlag: "spy.readyToDive" }],
      ok: "Mask sealed, snorkel clear. The hatch is no longer a rumour.",
    },
    {
      id: "briefing-complete",
      when: {
        all: [
          { holds: 8 },
          { holds: 9 },
          { holds: 10 },
          { flag: "not.spy.briefed" },
        ],
      },
      then: [{ setFlag: "spy.briefed" }, { grantBadge: "spy.briefed" }],
    },
  ],
  badges: [
    {
      id: "spy.briefed",
      title: "Night briefed",
      description: "Collected film, wet notebook, and clearance chit from the Bureau night shift.",
    },
  ],
  alchemy: [
    {
      id: "improv-dive",
      inputs: [4, 5],
      gives: 6,
      ok: "Parka snorkel and welding glass tape into a crude dive kit. Lateral thinking: authorised.",
    },
  ],
};

await mkdir(join(root, "scenes"), { recursive: true });
await mkdir(join(root, "artefacts"), { recursive: true });
await mkdir(join(root, "entrance-groups"), { recursive: true });
await mkdir(join(root, "quests"), { recursive: true });

for (const s of scenes) {
  const { id, title, body, details, detailWhen, when } = s;
  const meta = {
    id,
    owner,
    visibility: "public",
    title,
    createdAt: TS,
    modifiedAt: [],
    entranceGroupId: "1",
    ...(detailWhen ? { detailWhen } : {}),
    ...(when ? { when } : {}),
  };
  if (id === 1) meta.isJunction = false;
  await writeFile(join(root, "scenes", `${id}.md`), serializeProse(meta, body, details), "utf8");
  const ex = exits[id] ?? [];
  await writeFile(
    join(root, "scenes", `${id}.exits.json`),
    `${JSON.stringify(buildExits(ex), null, 2)}\n`,
    "utf8",
  );
}

for (const a of artefacts) {
  const { id, homeSceneId, title, body, details, tags, when } = a;
  const meta = {
    id,
    owner,
    homeSceneId,
    title,
    tags: tags ?? [],
    createdAt: TS,
    modifiedAt: [],
    ...(when ? { when } : {}),
  };
  await writeFile(join(root, "artefacts", `${id}.md`), serializeProse(meta, body, details ?? {}), "utf8");
}

await writeFile(
  join(root, "entrance-groups", "1.json"),
  `${JSON.stringify(
    {
      id: "1",
      title: "Bureau night shift",
      entranceSceneId: 1,
      sceneIds: scenes.map((s) => s.id),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(join(root, "quests", "spy.json"), `${JSON.stringify(quest, null, 2)}\n`, "utf8");

await writeFile(
  join(root, "meta.json"),
  `${JSON.stringify(
    {
      nextSceneId: 21,
      nextArtefactId: 12,
      nextGroupId: 1,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
      schemaVersion: 6,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const readme = `# Night Briefing (\`samples/briefing\`)

Original **Spycatcher-spirited** spy/HQ sample for Proseden — compact Bureau building, gadgets, soft time, wordplay alchemy. **Not** a port of Spy Snatcher / Spycatcher (or any other commercial title).

Default [\`seed/\`](../../seed/) is unchanged. This tree is opt-in for playtest and iteration.

## Boot

From the repo root, use an empty data directory so the sample is copied on first load:

\`\`\`bash
rm -rf /tmp/proseden-briefing-data
PROSEDEN_SEED=./samples/briefing PROSEDEN_DATA=/tmp/proseden-briefing-data npm start
\`\`\`

Sign in as **admin** / **admin** (same as seed). Resume lands in the Night Lobby.

If \`PROSEDEN_DATA\` already has a \`meta.json\`, the seed is **not** re-copied — wipe that data dir or point at a fresh path.

## Map

\`\`\`text
                    [Flat Roof]
                         |
Night Lobby ---- Ground Corridor ---- Roof Stair
    |                 |    |  |  \\
 Courtyard Park       |    |  |   Comms / Canteen / Plant / Yard
    |                 |    |  +-- Archive Landing -> Stacks -> Flooded -> Under-cistern
  Old Oak ---- Branches   |  +-- Records / Annexe -> Director
    |                     +-- Evidence Cage (pass)
 Service Yard
\`\`\`

Entrance group **Bureau night shift** forces teleports back to the Night Lobby.

## Puzzle checklist

| Beat | How |
|------|-----|
| Soft time | Every quest wake \`incVar spy.tick\`; after tick > 24, \`spy.shiftLate\` (lobby board / comms tape details) |
| Lamp | **Use** pocket torch → \`spy.lamp=12\`, drains each wake; archive lower door needs \`var:spy.lamp>0\` |
| Memo + safe | Collect cryptic memo + look at annexe calendar → Input \`3719\` in Director's Office → clearance chit |
| Pass | Collect visitor pass → **Use** in Ground Corridor → Evidence Cage exit |
| Alchemy | Combine **snorkel parka** + **welding mask** → dive kit → **Use** in Flooded Sub-basement → hatch exit |
| Season / wait | In Courtyard Park, Input \`wait\` twice → leaves fall → **Use** ladder at Old Oak → Branches → microfilm |
| Win | Hold microfilm + wet notebook + clearance chit → badge \`spy.briefed\` |

## Critical path (spoiler)

1. Desk → visitor pass; Records → memo; Annexe → calendar hint; Director → input \`3719\` → chit.
2. Corridor → use pass → Evidence Cage (flavour); Plant → torch + welding mask; Canteen → snorkel parka.
3. Alchemy combine → dive kit; torch on; Archive → Flooded → use kit → Under-cistern → wet notebook.
4. Yard → ladder; Park → wait, wait; Oak → use ladder → Branches → microfilm.
5. Badge grants when all three evidence artefacts are held.

## Iterate

- Prose is intentionally stubby — thicken without changing ids if you can help it (quest rules hard-code artefact/scene ids).
- Prefer new puzzles via \`quests/spy.json\` FlagRefs over new engine features.
- Regenerate the world from the content script after structural edits:

\`\`\`bash
node scripts/build-briefing-sample.mjs
\`\`\`

- When stable, load this world and call adventure-pack export (HTTP UI may land later).
`;

await writeFile(join(root, "README.md"), readme, "utf8");
console.log("Wrote samples/briefing");
