import { describe, expect, it } from "vitest";
import {
  buildDenseIdMap,
  buildOffsetIdMap,
  remapArtefact,
  remapExit,
  remapFlagRef,
  remapQuest,
  remapQuestPrefix,
  PackRemapError,
} from "./pack-remap.js";

describe("pack-remap", () => {
  it("builds dense and offset id maps", () => {
    const dense = buildDenseIdMap([5, 2, 9]);
    expect([...dense.entries()]).toEqual([
      [2, 1],
      [5, 2],
      [9, 3],
    ]);
    const offset = buildOffsetIdMap(3, 10);
    expect(offset.get(1)).toBe(10);
    expect(offset.get(3)).toBe(12);
  });

  it("rewrites holds FlagRefs including not. and lists", () => {
    const map = new Map([
      [12, 100],
      [3, 7],
    ]);
    expect(remapFlagRef("holds:12", map)).toBe("holds:100");
    expect(remapFlagRef("holds:not.12", map)).toBe("holds:not.100");
    expect(remapFlagRef("demo.open,holds:3;badge:demo.x", map)).toBe(
      "demo.open,holds:7;badge:demo.x",
    );
    expect(() => remapFlagRef("holds:99", map)).toThrow(PackRemapError);
  });

  it("remaps exits, artefacts, and quest preds", () => {
    const sceneMap = new Map([
      [1, 10],
      [2, 11],
    ]);
    const artefactMap = new Map([
      [5, 50],
      [6, 51],
    ]);
    expect(
      remapExit(
        { exitId: 1, nickname: "east", toSceneId: 2, createdAt: "t", when: "holds:5" },
        sceneMap,
        artefactMap,
      ),
    ).toEqual({
      exitId: 1,
      nickname: "east",
      toSceneId: 11,
      createdAt: "t",
      when: "holds:50",
    });
    expect(
      remapArtefact(
        {
          id: 5,
          owner: "a",
          homeSceneId: 1,
          title: "Key",
          tags: [],
          createdAt: "t",
          modifiedAt: [],
          body: "b",
          details: {},
          when: "holds:6",
        },
        sceneMap,
        artefactMap,
      ).id,
    ).toBe(50);

    const quest = remapQuest(
      {
        name: "demo",
        rules: [
          {
            id: "r",
            when: { all: [{ holds: 5 }, { atScene: 2 }] },
            then: [{ setFlag: "demo.has" }, { giveArtefact: 6 }],
          },
        ],
        badges: [{ id: "demo.badge", title: "B" }],
        alchemy: [{ id: "mix", inputs: [5, 6], gives: 6 }],
      },
      sceneMap,
      artefactMap,
      new Map([["demo", "cave"]]),
    );
    expect(quest.name).toBe("cave");
    expect(quest.rules[0]?.when).toEqual({ all: [{ holds: 50 }, { atScene: 11 }] });
    expect(quest.rules[0]?.then).toEqual([{ setFlag: "cave.has" }, { giveArtefact: 51 }]);
    expect(quest.badges?.[0]?.id).toBe("cave.badge");
    expect(quest.alchemy?.[0]?.gives).toBe(51);
  });

  it("remaps quest prefixes at token boundaries", () => {
    expect(remapQuestPrefix("demo.hasKey", "demo", "cave")).toBe("cave.hasKey");
    expect(remapQuestPrefix("flag:not.demo.x", "demo", "cave")).toBe("flag:not.cave.x");
    expect(remapQuestPrefix("builders.demo.x", "demo", "cave")).toBe("builders.demo.x");
    expect(remapQuestPrefix("demo.hasKey", "demo", "demo")).toBe("demo.hasKey");
  });
});
