import { describe, expect, it } from "vitest";
import type { ExitRecord } from "../src/model/types.js";
import {
  artefactPageView,
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

  it("renders text home line", () => {
    const text = toText(artefactPageView({ artefact: mantel }).body, {
      basePath: "",
    });
    expect(text).toContain("[Artefact 1: Mantel Card]");
    expect(text).toContain("home: /s/1?from=1");
    expect(text).toContain("tags: paper");
  });
});
