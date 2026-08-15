import { describe, expect, it } from "vitest";
import type { SceneRecord } from "../model/types.js";
import { resolveSceneDetails, visibleArtefacts, visibleExits } from "./world-view.js";

describe("world-view gates", () => {
  it("hides hidden exits until flag", () => {
    const exits = [
      { exitId: 1, nickname: "east", toSceneId: 2, createdAt: "", when: { flag: "q.open" }, hidden: true },
      { exitId: 2, nickname: "west", toSceneId: 3, createdAt: "", when: { flag: "q.open" } },
    ];
    expect(visibleExits(exits, {}).map((e) => e.nickname)).toEqual(["west"]);
    expect(visibleExits(exits, { "q.open": true }).map((e) => e.nickname)).toEqual(["east", "west"]);
  });

  it("filters artefacts by when", () => {
    const arts = [
      { id: 1, owner: "a", homeSceneId: 1, tags: [], createdAt: "", modifiedAt: [], body: "", details: {} },
      {
        id: 2,
        owner: "a",
        homeSceneId: 1,
        tags: [],
        createdAt: "",
        modifiedAt: [],
        body: "",
        details: {},
        when: { flag: "q.show" },
      },
    ];
    expect(visibleArtefacts(arts, {}).map((a) => a.id)).toEqual([1]);
    expect(visibleArtefacts(arts, { "q.show": true }).map((a) => a.id)).toEqual([1, 2]);
  });

  it("swaps and hides details", () => {
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
        "passage.cool": { flag: "q.cooled" },
        secret: { flag: "q.secret" },
      },
      detailSwap: {
        passage: ["passage.cool", "passage"],
      },
    } satisfies SceneRecord;
    expect(resolveSceneDetails(scene, {})).toEqual({ passage: "hot" });
    expect(resolveSceneDetails(scene, { "q.cooled": true })).toEqual({ passage: "cool" });
    expect(resolveSceneDetails(scene, { "q.secret": true }).secret).toBe("shh");
  });
});
