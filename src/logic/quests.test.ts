import { describe, expect, it } from "vitest";
import { evaluateFlagPred, evaluateFlagRef, evaluatePred, isFlagOnlyPred } from "./pred.js";
import {
  applyFlagEffects,
  evaluateQuests,
  matchAlchemyRecipe,
  parseQuestFile,
} from "./quests.js";

describe("pred", () => {
  const base = {
    flags: { "q.a": true } as Record<string, boolean | number | string>,
    badges: new Set<string>(["q.badge"]),
    inventoryIds: new Set([1, 2]),
    artefactTags: new Map<number, readonly string[]>([[1, ["key"]], [2, ["orb"]]]),
    atSceneId: 5,
    scenesOwned: 3,
  };

  it("missing flag is false", () => {
    expect(evaluatePred({ flag: "q.missing" }, base)).toBe(false);
  });

  it("all / any / not", () => {
    expect(evaluatePred({ all: [{ flag: "q.a" }, { holds: 1 }] }, base)).toBe(true);
    expect(evaluatePred({ any: [{ flag: "q.missing" }, { holds: 1 }] }, base)).toBe(true);
    expect(evaluatePred({ not: { flag: "q.a" } }, base)).toBe(false);
  });

  it("flag-only detection (quest Pred; world gates use FlagRef)", () => {
    expect(isFlagOnlyPred({ flag: "q.a" })).toBe(true);
    expect(isFlagOnlyPred({ all: [{ flag: "q.a" }, { not: { flag: "q.b" } }] })).toBe(true);
    expect(isFlagOnlyPred({ holds: 1 })).toBe(false);
    expect(evaluateFlagPred({ flag: "q.a" }, { "q.a": true })).toBe(true);
    expect(evaluateFlagPred({ holds: 1 }, {})).toBe(false);
  });

  it("FlagRef not. invert", () => {
    expect(evaluateFlagRef("q.a", base.flags)).toBe(true);
    expect(evaluateFlagRef("not.q.a", base.flags)).toBe(false);
    expect(evaluateFlagRef("not.q.missing", {})).toBe(true);
  });
});

describe("quest eval", () => {
  it("rejects non-flag then effects", () => {
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { holds: 1 }, then: [{ grantBadge: "demo.x" }] }],
      }),
    ).toThrow(/setFlag\/clearFlag/);
  });

  it("cascades flag rules and grants badge once per transition", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        { id: "a", when: { holds: 1 }, then: [{ setFlag: "demo.has", to: true }] },
        {
          id: "b",
          when: { flag: "demo.has" },
          then: [{ setFlag: "demo.done", to: true }],
        },
      ],
      onFlag: {
        "demo.done": { onTrue: [{ grantBadge: "demo.winner" }] },
      },
      badges: [{ id: "demo.winner", title: "Winner" }],
    });

    const r1 = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      predContext: {
        inventoryIds: new Set([1]),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(r1.flags["demo.has"]).toBe(true);
    expect(r1.flags["demo.done"]).toBe(true);
    expect(r1.badges).toEqual(["demo.winner"]);

    const r2 = evaluateQuests({
      quests: [quest],
      flags: r1.flags,
      badges: [],
      predContext: {
        inventoryIds: new Set([1]),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(r2.badges).toEqual([]);
  });

  it("does not throw when a rule when-clause is malformed", () => {
    const result = evaluateQuests({
      quests: [
        {
          name: "broken",
          rules: [
            { id: "bad", when: { all: "nope" as unknown as [] }, then: [{ setFlag: "broken.x" }] },
            { id: "ok", when: { holds: 1 }, then: [{ setFlag: "broken.y", to: true }] },
          ],
        },
      ],
      flags: {},
      badges: [],
      predContext: {
        inventoryIds: new Set([1]),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(result.flags["broken.y"]).toBe(true);
    expect(result.flags["broken.x"]).toBeUndefined();
  });

  it("applyFlagEffects no-ops same value", () => {
    const { changes } = applyFlagEffects({ "q.a": true }, [{ setFlag: "q.a", to: true }]);
    expect(changes).toEqual([]);
  });
});

describe("alchemy match", () => {
  it("matches 3 inputs by id and tag", () => {
    const recipe = {
      id: "mix",
      inputs: [1, { tag: "citrus" }, 3] as Array<number | { tag: string }>,
      gives: 9,
    };
    const tags = new Map<number, readonly string[]>([
      [1, []],
      [2, ["citrus"]],
      [3, []],
    ]);
    expect(matchAlchemyRecipe([recipe], [3, 1, 2], tags)?.id).toBe("mix");
    expect(matchAlchemyRecipe([recipe], [1, 2], tags)).toBeUndefined();
  });
});
