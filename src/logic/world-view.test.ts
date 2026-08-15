import { describe, expect, it } from "vitest";
import type { SceneRecord } from "../model/types.js";
import { evaluateFlagRef } from "./pred.js";
import {
  resolveArtefactDetails,
  resolveSceneDetails,
  sceneAllowed,
  visibleArtefacts,
  visibleExits,
} from "./world-view.js";

describe("FlagRef", () => {
  it("requires flag === true; not. inverts", () => {
    expect(evaluateFlagRef("q.open", {})).toBe(false);
    expect(evaluateFlagRef("q.open", { "q.open": true })).toBe(true);
    expect(evaluateFlagRef("q.open", { "q.open": false })).toBe(false);
    expect(evaluateFlagRef("not.q.open", {})).toBe(true);
    expect(evaluateFlagRef("not.q.open", { "q.open": true })).toBe(false);
    expect(evaluateFlagRef(undefined, {})).toBe(true);
    expect(evaluateFlagRef("", {})).toBe(true);
  });
});

describe("world-view gates", () => {
  it("hides hidden exits until flag", () => {
    const exits = [
      {
        exitId: 1,
        nickname: "east",
        toSceneId: 2,
        createdAt: "",
        when: "q.open",
        hidden: true,
      },
      { exitId: 2, nickname: "west", toSceneId: 3, createdAt: "", when: "q.open" },
    ];
    expect(visibleExits(exits, {}).map((e) => e.nickname)).toEqual(["west"]);
    expect(visibleExits(exits, { "q.open": true }).map((e) => e.nickname)).toEqual([
      "east",
      "west",
    ]);
  });

  it("filters artefacts by when", () => {
    const arts = [
      {
        id: 1,
        owner: "a",
        homeSceneId: 1,
        tags: [],
        createdAt: "",
        modifiedAt: [],
        body: "",
        details: {},
      },
      {
        id: 2,
        owner: "a",
        homeSceneId: 1,
        tags: [],
        createdAt: "",
        modifiedAt: [],
        body: "",
        details: {},
        when: "q.show",
      },
    ];
    expect(visibleArtefacts(arts, {}).map((a) => a.id)).toEqual([1]);
    expect(visibleArtefacts(arts, { "q.show": true }).map((a) => a.id)).toEqual([1, 2]);
  });

  it("sceneAllowed uses FlagRef", () => {
    const scene = {
      id: 1,
      owner: "a",
      visibility: "public" as const,
      createdAt: "",
      modifiedAt: [],
      body: "x",
      details: {},
      when: "cellar.unlocked",
    } satisfies SceneRecord;
    expect(sceneAllowed(scene, {})).toBe(false);
    expect(sceneAllowed(scene, { "cellar.unlocked": true })).toBe(true);
  });

  it("hides details via FlagRef; legacy swap still loads", () => {
    const scene = {
      id: 1,
      owner: "a",
      visibility: "public" as const,
      createdAt: "",
      modifiedAt: [],
      body: "fixed",
      details: {
        passage: "hot",
        "passage.cool": "cool",
        secret: "shh",
      },
      detailWhen: {
        "passage.cool": "q.cooled",
        secret: "q.secret",
      },
      detailSwap: {
        passage: ["passage.cool", "passage"],
      },
    } satisfies SceneRecord;
    expect(resolveSceneDetails(scene, {})).toEqual({ passage: "hot" });
    expect(resolveSceneDetails(scene, { "q.cooled": true })).toEqual({ passage: "cool" });
    expect(resolveSceneDetails(scene, { "q.secret": true }).secret).toBe("shh");
  });

  it("hides details with inverse FlagRef pairs", () => {
    const scene = {
      id: 1,
      owner: "a",
      visibility: "public" as const,
      createdAt: "",
      modifiedAt: [],
      body: "fixed",
      details: {
        passage: "hot",
        "cooled passage": "cool",
      },
      detailWhen: {
        passage: "not.q.cooled",
        "cooled passage": "q.cooled",
      },
    } satisfies SceneRecord;
    expect(resolveSceneDetails(scene, {})).toEqual({ passage: "hot" });
    expect(resolveSceneDetails(scene, { "q.cooled": true })).toEqual({
      "cooled passage": "cool",
    });
  });

  it("resolves artefact details", () => {
    const art = {
      id: 1,
      owner: "a",
      homeSceneId: 1,
      tags: [],
      createdAt: "",
      modifiedAt: [],
      body: "x",
      details: { mark: "runes", plain: "wood" },
      detailWhen: { mark: "q.read" },
    };
    expect(resolveArtefactDetails(art, {})).toEqual({ plain: "wood" });
    expect(resolveArtefactDetails(art, { "q.read": true })).toEqual({
      mark: "runes",
      plain: "wood",
    });
  });
});
