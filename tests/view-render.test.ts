import { describe, expect, it } from "vitest";
import type { ExitRecord } from "../src/model/types.js";
import {
  artefactPageView,
  dashboardPageView,
  scenePageView,
  toHtml,
  toText,
} from "../src/render/view/index.js";
import { artefact, scene } from "./helpers/fixtures.js";

const threshold = scene(1, "gardener", {
  title: "Threshold",
  body: "A stone lintel. _Quiet_ rain.",
  details: { card: "A calling card." },
  visibility: "public",
});

const exits: ExitRecord[] = [
  {
    exitId: 1,
    toSceneId: 2,
    nickname: "study",
    createdAt: "2020-01-01T00:00:00.000Z",
  },
];

const mantel = artefact(1, "gardener", 1, {
  title: "Mantel Card",
  body: "Ivory stock.",
  tags: ["paper"],
});

describe("scenePageView", () => {
  it("renders HTML with prose, links, and actions", () => {
    const html = toHtml(
      scenePageView({ scene: threshold, exits, artefacts: [mantel] }).body,
    );
    expect(html).toContain("<h1>Threshold");
    expect(html).toContain('href="u/gardener"');
    expect(html).toContain("<em>Quiet</em>");
    expect(html).toContain('href="s/1?card"');
    expect(html).toContain('href="a/1"');
    expect(html).toContain('href="s/1/go/1"');
    expect(html).toContain('id="travel-form"');
    expect(html).not.toContain("data-editor");
  });

  it("renders text with recipes and basePath", () => {
    const text = toText(
      scenePageView({ scene: threshold, exits, artefacts: [mantel] }).body,
      { basePath: "" },
    );
    expect(text).toContain("[Scene 1: Threshold]");
    expect(text).toContain("by gardener  /u/gardener");
    expect(text).toContain("visibility: public");
    expect(text).toContain("A stone lintel. _Quiet_ rain.");
    expect(text).toContain("- card  /s/1?card");
    expect(text).toContain("1. Mantel Card  /a/1");
    expect(text).toContain("- study  /s/1/go/1");
    expect(text).toContain("Teleport: GET /s/<id>?from=1");
    expect(text).toContain("Invite to view: POST /s/1/view-invites");
  });

  it("shows Input for signed-in readers", () => {
    const html = toHtml(
      scenePageView({
        scene: threshold,
        exits,
        artefacts: [],
        showInput: true,
      }).body,
    );
    expect(html).toContain('id="input-form"');
    expect(html).toContain('name="phrase"');
    const text = toText(
      scenePageView({
        scene: threshold,
        exits,
        artefacts: [],
        showInput: true,
      }).body,
      { basePath: "" },
    );
    expect(text).toContain("Input: POST /s/1/input");
  });

  it("prefixes assetBase in text mode", () => {
    const text = toText(
      scenePageView({ scene: threshold, exits, artefacts: [] }).body,
      { basePath: "/garden" },
    );
    expect(text).toContain("by gardener  /garden/u/gardener");
    expect(text).toContain("Teleport: GET /garden/s/<id>?from=1");
  });
});

describe("artefactPageView", () => {
  it("renders HTML crumb and collect form", () => {
    const html = toHtml(
      artefactPageView({ artefact: mantel, collected: false }).body,
    );
    expect(html).toContain("← Scene 1");
    expect(html).toContain("Mantel Card");
    expect(html).toContain("Collect");
  });

  it("shows Use next to drop when held", () => {
    const html = toHtml(
      artefactPageView({ artefact: mantel, collected: true }).body,
    );
    expect(html).toContain('action="a/1/use"');
    expect(html).toContain("Use");
    expect(html).toContain("Remove from inventory");
    expect(html).not.toContain(">Collect<");
  });

  it("renders text home line", () => {
    const text = toText(artefactPageView({ artefact: mantel }).body, {
      basePath: "",
    });
    expect(text).toContain("[Artefact 1: Mantel Card]");
    expect(text).toContain("home: /s/1?from=1");
    expect(text).toContain("tags: paper");
  });
});

const overviewCounts = {
  users: 2,
  scenes: 3,
  artefacts: 4,
  exits: 5,
  groups: 1,
  entranceGroups: 1,
  quests: 2,
  userQuestFiles: 0,
  alchemyRecipes: 6,
  userAlchemyFiles: 1,
  inbox: 7,
  staff: 1,
};

describe("dashboardPageView", () => {
  it("renders HTML counts and drill-down links", () => {
    const html = toHtml(
      dashboardPageView({
        counts: overviewCounts,
        online: 1,
        back: { href: "s/1", label: "← Scene 1" },
      }).body,
    );
    expect(html).toContain("<h1>Dashboard</h1>");
    expect(html).toContain("<dt>Users</dt><dd>2</dd>");
    expect(html).toContain('href="live/admin">Online</a>');
    expect(html).toContain("<dd>1</dd>");
    expect(html).toContain('href="staff">Staff</a>');
    expect(html).toContain("<dt>Scenes</dt><dd>3</dd>");
    expect(html).toContain("<dt>Artefacts</dt><dd>4</dd>");
    expect(html).toContain('href="data/quests">Quests</a>');
    expect(html).toContain('href="data">Data</a>');
  });

  it("renders text counts and prefixes assetBase", () => {
    const text = toText(
      dashboardPageView({ counts: overviewCounts, online: 1 }).body,
      { basePath: "/garden" },
    );
    expect(text).toContain("[Dashboard]");
    expect(text).toContain("Users: 2");
    expect(text).toContain("Online: 1  /garden/live/admin");
    expect(text).toContain("Scenes: 3");
    expect(text).toContain("Quests: 2  /garden/data/quests");
    expect(text).toContain("- Data (backups, reload, quests, alchemy)  /garden/data");
  });

  it("renders process stats and slow request lines", () => {
    const process = {
      uptimeSec: 12,
      rssMb: 40.1,
      heapUsedMb: 12.2,
      lagP99Ms: 1.2,
      lagMaxMs: 4,
      sseConnections: 2,
      slowMs: 500,
      slowLines: ["GET /s/12 200 842ms ownedScenes=12"],
    };
    const html = toHtml(
      dashboardPageView({
        counts: overviewCounts,
        online: 1,
        process,
      }).body,
    );
    expect(html).toContain("<h2>Process</h2>");
    expect(html).toContain("<dt>Uptime (s)</dt><dd>12</dd>");
    expect(html).toContain("<dt>RSS (MB)</dt><dd>40.1</dd>");
    expect(html).toContain("<dt>Event-loop p99 (ms)</dt><dd>1.2</dd>");
    expect(html).toContain("<dt>Event-loop max (ms)</dt><dd>4</dd>");
    expect(html).toContain('href="live/admin">SSE connections</a>');
    expect(html).toContain("<dd>2</dd>");
    expect(html).toContain("<h2>Recent slow requests</h2>");
    expect(html).toContain("GET /s/12 200 842ms ownedScenes=12");

    const text = toText(dashboardPageView({ counts: overviewCounts, online: 1, process }).body);
    expect(text).toContain("Process:");
    expect(text).toContain("RSS (MB): 40.1");
    expect(text).toContain("GET /s/12 200 842ms ownedScenes=12");
  });
});
