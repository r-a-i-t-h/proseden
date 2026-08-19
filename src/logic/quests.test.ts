import { describe, expect, it } from "vitest";
import { evaluateFlagPred, evaluateFlagRef, evaluatePred, gateFacts, isFlagOnlyPred, normalizeInputPhrase } from "./pred.js";
import {
  applyFlagEffects,
  evaluateQuests,
  matchAlchemyRecipe,
  parseQuestFile,
  questActionMessage,
  sanitizeUserFlags,
} from "./quests.js";

describe("pred", () => {
  const base = {
    flags: { "q.a": true },
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

  it("FlagRef default is the flag scheme; flag: is optional", () => {
    expect(evaluateFlagRef("q.a", gateFacts({ flags: base.flags }))).toBe(true);
    expect(evaluateFlagRef("flag:q.a", gateFacts({ flags: base.flags }))).toBe(true);
    expect(evaluateFlagRef("not.q.a", gateFacts({ flags: base.flags }))).toBe(false);
    expect(evaluateFlagRef("not.q.missing", gateFacts())).toBe(true);
    expect(evaluateFlagRef("holds:1", gateFacts({ inventoryIds: base.inventoryIds }))).toBe(true);
    expect(evaluateFlagRef("holds:not.1", gateFacts({ inventoryIds: base.inventoryIds }))).toBe(
      false,
    );
    expect(evaluateFlagRef("badge:q.badge", gateFacts({ badges: base.badges }))).toBe(true);
    expect(evaluateFlagRef("atScene:5", gateFacts({ flags: { "atScene:5": true } }))).toBe(false);
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

  it("rejects numeric or string setFlag to", () => {
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { holds: 1 }, then: [{ setFlag: "demo.x", to: 2 }] }],
      }),
    ).toThrow(/setFlag to must be a boolean/);
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { holds: 1 }, then: [{ setFlag: "demo.x", to: "calm" }] }],
      }),
    ).toThrow(/setFlag to must be a boolean/);
  });

  it("rejects non-boolean flag is", () => {
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { flag: "demo.x", is: "calm" }, then: [{ setFlag: "demo.x" }] }],
      }),
    ).toThrow(/flag is must be a boolean/);
  });

  it("sanitizeUserFlags drops non-booleans", () => {
    expect(sanitizeUserFlags({ "q.a": true, "q.n": 2, "q.s": "calm", "q.f": false })).toEqual({
      "q.a": true,
      "q.f": false,
    });
    expect(sanitizeUserFlags(null)).toEqual({});
    expect(sanitizeUserFlags(["nope"])).toEqual({});
  });

  it("rejects use/input atoms on always rules and missing atoms", () => {
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { uses: 12 }, then: [{ setFlag: "demo.x" }] }],
      }),
    ).toThrow(/uses is only valid on use rules/);
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { input: "hi" }, then: [{ setFlag: "demo.x" }] }],
      }),
    ).toThrow(/input is only valid on input rules/);
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", on: "use", when: { atScene: 5 }, then: [{ setFlag: "demo.x" }] }],
      }),
    ).toThrow(/must include \{ uses \}/);
    expect(() =>
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", on: "input", when: { atScene: 5 }, then: [{ setFlag: "demo.x" }] }],
      }),
    ).toThrow(/must include \{ input \}/);
  });

  it("normalizes input phrases", () => {
    expect(normalizeInputPhrase("  Open   SESAME ")).toBe("open sesame");
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        {
          id: "r",
          on: "input",
          when: { input: "  Open   SESAME " },
          then: [{ setFlag: "demo.ok" }],
        },
      ],
    });
    expect(quest.rules[0]?.when).toEqual({ input: "open sesame" });
  });

  it("runs use/input rules only on their trigger", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        { id: "always", when: { holds: 1 }, then: [{ setFlag: "demo.held" }] },
        {
          id: "use-key",
          on: "use",
          ok: "The lock yields.",
          when: { all: [{ uses: 12 }, { atScene: 5 }] },
          then: [{ setFlag: "demo.used" }],
        },
        {
          id: "say",
          on: "input",
          ok: "The wall slides.",
          when: { input: "open sesame" },
          then: [{ setFlag: "demo.spoke" }],
        },
      ],
    });
    const ctx = {
      inventoryIds: new Set([1, 12]),
      artefactTags: new Map<number, readonly string[]>(),
      atSceneId: 5,
      scenesOwned: 0,
    };
    const onCollect = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      predContext: ctx,
    });
    expect(onCollect.flags["demo.held"]).toBe(true);
    expect(onCollect.flags["demo.used"]).toBeUndefined();
    expect(onCollect.flags["demo.spoke"]).toBeUndefined();
    expect(onCollect.actionMatched).toBe(false);

    const onUse = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      trigger: "use",
      predContext: { ...ctx, usesArtefactId: 12 },
    });
    expect(onUse.flags["demo.held"]).toBe(true);
    expect(onUse.flags["demo.used"]).toBe(true);
    expect(onUse.flags["demo.spoke"]).toBeUndefined();
    expect(onUse.actionMatched).toBe(true);
    expect(questActionMessage(onUse)).toBe("The lock yields.");

    const onUseWrongItem = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      trigger: "use",
      predContext: { ...ctx, usesArtefactId: 1 },
    });
    expect(onUseWrongItem.flags["demo.used"]).toBeUndefined();
    expect(questActionMessage(onUseWrongItem)).toBe("Nothing happens.");

    const onInput = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      trigger: "input",
      predContext: { ...ctx, inputPhrase: normalizeInputPhrase("OPEN sesame") },
    });
    expect(onInput.flags["demo.spoke"]).toBe(true);
    expect(onInput.flags["demo.used"]).toBeUndefined();
    expect(questActionMessage(onInput)).toBe("The wall slides.");
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

  it("skips recipes rejected by recipeAllowed", () => {
    const blocked = {
      id: "blocked",
      inputs: [1, 2] as Array<number | { tag: string }>,
      gives: 9,
      author: "bob",
    };
    const ok = {
      id: "ok",
      inputs: [1, 2] as Array<number | { tag: string }>,
      gives: 10,
    };
    const tags = new Map<number, readonly string[]>();
    expect(
      matchAlchemyRecipe([blocked, ok], [1, 2], tags, (r) => !r.author)?.id,
    ).toBe("ok");
  });
});
