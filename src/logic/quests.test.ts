import { describe, expect, it } from "vitest";
import {
  evaluateFlagPred,
  evaluateFlagRef,
  evaluatePred,
  gateFacts,
  isFlagOnlyPred,
  normalizeInputPhrase,
} from "./pred.js";
import {
  applyThenEffects,
  evaluateQuests,
  matchAlchemyRecipe,
  parseQuestFile,
  questActionMessage,
  sanitizeUserFlags,
  sanitizeUserVars,
} from "./quests.js";

describe("pred", () => {
  const base = {
    flags: { "q.a": true },
    badges: new Set<string>(["q.badge"]),
    inventoryIds: new Set([1, 2]),
    artefactTags: new Map<number, readonly string[]>([[1, ["key"]], [2, ["orb"]]]),
    atSceneId: 5,
    scenesOwned: 3,
    vars: { "q.n": 2 },
  };

  it("missing flag is false", () => {
    expect(evaluatePred({ flag: "q.missing" }, base)).toBe(false);
  });

  it("flag not. prefix inverts set/clear", () => {
    expect(evaluatePred({ flag: "not.q.a" }, base)).toBe(false);
    expect(evaluatePred({ flag: "not.q.missing" }, base)).toBe(true);
    expect(evaluatePred({ flag: "not.q.a" }, base)).toBe(
      evaluatePred({ not: { flag: "q.a" } }, base),
    );
    expect(evaluatePred({ flag: "not." }, base)).toBe(false);
  });

  it("all / any / not", () => {
    expect(evaluatePred({ all: [{ flag: "q.a" }, { holds: 1 }] }, base)).toBe(true);
    expect(evaluatePred({ any: [{ flag: "q.missing" }, { holds: 1 }] }, base)).toBe(true);
    expect(evaluatePred({ not: { flag: "q.a" } }, base)).toBe(false);
  });

  it("scenesOwned number means >=", () => {
    expect(evaluatePred({ scenesOwned: 3 }, base)).toBe(true);
    expect(evaluatePred({ scenesOwned: 4 }, base)).toBe(false);
  });

  it("var compares; unset reads as 0", () => {
    expect(evaluatePred({ var: "q.n", "=": 2 }, base)).toBe(true);
    expect(evaluatePred({ var: "q.n", ">": 1 }, base)).toBe(true);
    expect(evaluatePred({ var: "q.n", "<": 2 }, base)).toBe(false);
    expect(evaluatePred({ var: "q.missing", "=": 0 }, base)).toBe(true);
    expect(evaluatePred({ var: "q.missing", ">": 0 }, base)).toBe(false);
  });

  it("flag-only detection (quest Pred; world gates use FlagRef)", () => {
    expect(isFlagOnlyPred({ flag: "q.a" })).toBe(true);
    expect(isFlagOnlyPred({ all: [{ flag: "q.a" }, { not: { flag: "q.b" } }] })).toBe(true);
    expect(isFlagOnlyPred({ holds: 1 })).toBe(false);
    expect(evaluateFlagPred({ flag: "q.a" }, { "q.a": true })).toBe(true);
    expect(evaluateFlagPred({ holds: 1 }, {})).toBe(false);
  });

  it("FlagRef schemes including var", () => {
    expect(evaluateFlagRef("q.a", gateFacts({ flags: base.flags }))).toBe(true);
    expect(evaluateFlagRef("flag:q.a", gateFacts({ flags: base.flags }))).toBe(true);
    expect(evaluateFlagRef("not.q.a", gateFacts({ flags: base.flags }))).toBe(false);
    expect(evaluateFlagRef("holds:1", gateFacts({ inventoryIds: base.inventoryIds }))).toBe(true);
    expect(evaluateFlagRef("badge:q.badge", gateFacts({ badges: base.badges }))).toBe(true);
    expect(evaluateFlagRef("var:q.n=2", gateFacts({ vars: base.vars }))).toBe(true);
    expect(evaluateFlagRef("var:q.n>1", gateFacts({ vars: base.vars }))).toBe(true);
    expect(evaluateFlagRef("var:q.n<2", gateFacts({ vars: base.vars }))).toBe(false);
    expect(evaluateFlagRef("var:q.missing=0", gateFacts())).toBe(true);
    expect(evaluateFlagRef("var:not.q.n=2", gateFacts({ vars: base.vars }))).toBe(false);
    expect(evaluateFlagRef("var:q.n>=2", gateFacts({ vars: base.vars }))).toBe(false);
    expect(evaluateFlagRef("atScene:5", gateFacts({ flags: { "atScene:5": true } }))).toBe(false);
  });
});

describe("quest eval", () => {
  it("skips rules with invalid then; accepts grantBadge in then", () => {
    const q = parseQuestFile({
      name: "demo",
      rules: [
        { id: "bad", when: { holds: 1 }, then: [{ nope: true }] },
        {
          id: "ok",
          when: { holds: 1 },
          then: [{ setFlag: "demo.x" }, { grantBadge: "demo.x" }],
        },
      ],
    });
    expect(q.rules.map((r) => r.id)).toEqual(["ok"]);
  });

  it("rejects setFlag to false; strips to true; rejects other to", () => {
    expect(
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { holds: 1 }, then: [{ setFlag: "demo.x", to: false }] }],
      }).rules,
    ).toEqual([]);
    const q = parseQuestFile({
      name: "demo",
      rules: [{ id: "x", when: { holds: 1 }, then: [{ setFlag: "demo.x", to: true }] }],
    });
    expect(q.rules[0]!.then).toEqual([{ setFlag: "demo.x" }]);
  });

  it("skips flag is and bare not. flag id", () => {
    expect(
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { flag: "demo.x", is: true }, then: [{ setFlag: "demo.x" }] }],
      }).rules,
    ).toEqual([]);
    const q = parseQuestFile({
      name: "demo",
      rules: [{ id: "x", when: { flag: "not.demo.y" }, then: [{ setFlag: "demo.x" }] }],
    });
    expect(q.rules[0]!.when).toEqual({ flag: "not.demo.y" });
  });

  it("sanitizeUserFlags keeps only true; drops false and non-booleans", () => {
    expect(sanitizeUserFlags({ "q.a": true, "q.n": 2, "q.s": "calm", "q.f": false })).toEqual({
      "q.a": true,
    });
    expect(sanitizeUserFlags(null)).toEqual({});
  });

  it("sanitizeUserVars keeps finite non-zero numbers", () => {
    expect(sanitizeUserVars({ "q.a": 3, "q.z": 0, "q.s": "x", "q.n": NaN })).toEqual({ "q.a": 3 });
  });

  it("skips use/input atoms on always rules and missing atoms; rejects on always", () => {
    expect(
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", when: { use: 12 }, then: [{ setFlag: "demo.x" }] }],
      }).rules,
    ).toEqual([]);
    expect(
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", on: "always", when: { holds: 1 }, then: [{ setFlag: "demo.x" }] }],
      }).rules,
    ).toEqual([]);
    expect(
      parseQuestFile({
        name: "demo",
        rules: [{ id: "x", on: "use", when: { atScene: 5 }, then: [{ setFlag: "demo.x" }] }],
      }).rules,
    ).toEqual([]);
  });

  it("skips legacy uses and scenesOwned.gte shapes", () => {
    expect(
      parseQuestFile({
        name: "demo",
        rules: [
          { id: "old-use", on: "use", when: { uses: 12 }, then: [{ setFlag: "demo.x" }] },
          { id: "old-gte", when: { scenesOwned: { gte: 5 } }, then: [{ setFlag: "demo.y" }] },
          { id: "ok", when: { scenesOwned: 5 }, then: [{ setFlag: "demo.z" }] },
        ],
      }).rules.map((r) => r.id),
    ).toEqual(["ok"]);
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

  it("runs use/input rules only on their wake; order matters within one pass", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        { id: "always", when: { holds: 1 }, then: [{ setFlag: "demo.held" }] },
        {
          id: "use-key",
          on: "use",
          ok: "The lock yields.",
          when: { all: [{ use: 12 }, { atScene: 5 }] },
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
    expect(onCollect.actionMatched).toBe(false);

    const onUse = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      wake: "use",
      predContext: { ...ctx, useArtefactId: 12 },
    });
    expect(onUse.flags["demo.used"]).toBe(true);
    expect(onUse.actionMatched).toBe(true);
    expect(questActionMessage(onUse)).toBe("The lock yields.");

    const onUseWrongItem = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      wake: "use",
      predContext: { ...ctx, useArtefactId: 1 },
    });
    expect(onUseWrongItem.flags["demo.used"]).toBeUndefined();
    expect(questActionMessage(onUseWrongItem)).toBe("Nothing happens.");

    const onInput = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      wake: "input",
      predContext: { ...ctx, inputPhrase: normalizeInputPhrase("OPEN sesame") },
    });
    expect(onInput.flags["demo.spoke"]).toBe(true);
    expect(questActionMessage(onInput)).toBe("The wall slides.");
  });

  it("single pass: later rules see earlier effects; grantBadge in then", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        { id: "a", when: { holds: 1 }, then: [{ setFlag: "demo.has" }] },
        {
          id: "b",
          when: { flag: "demo.has" },
          then: [{ setFlag: "demo.done" }, { grantBadge: "demo.winner" }],
        },
      ],
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
      badges: r1.badges,
      predContext: {
        inventoryIds: new Set([1]),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(r2.badges).toEqual(["demo.winner"]);
  });

  it("giveArtefact mid-eval unlocks later on:gain; inventory visible to holds", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        {
          id: "grant",
          when: { flag: "demo.go" },
          then: [{ giveArtefact: 99 }],
        },
        {
          id: "react",
          on: "gain",
          when: { all: [{ gain: 99 }, { holds: 99 }] },
          then: [{ setFlag: "demo.got" }],
        },
      ],
    });
    const r = evaluateQuests({
      quests: [quest],
      flags: { "demo.go": true },
      badges: [],
      canGiveArtefact: (id) => id === 99,
      predContext: {
        inventoryIds: new Set(),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(r.grantedArtefactIds).toEqual([99]);
    expect(r.flags["demo.got"]).toBe(true);
  });

  it("setVar is idempotent; higher step before lower for shared input", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        {
          id: "to-2",
          on: "input",
          when: { all: [{ input: "wait" }, { var: "demo.dust", "=": 1 }] },
          then: [{ setVar: "demo.dust", to: 2 }],
        },
        {
          id: "to-1",
          on: "input",
          when: { all: [{ input: "wait" }, { var: "demo.dust", "=": 0 }] },
          then: [{ setVar: "demo.dust", to: 1 }],
        },
      ],
    });
    const ctx = {
      inventoryIds: new Set<number>(),
      artefactTags: new Map<number, readonly string[]>(),
      scenesOwned: 0,
    };
    const first = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      wake: "input",
      predContext: { ...ctx, inputPhrase: "wait" },
    });
    expect(first.vars["demo.dust"]).toBe(1);

    const second = evaluateQuests({
      quests: [quest],
      flags: {},
      vars: first.vars,
      badges: [],
      wake: "input",
      predContext: { ...ctx, inputPhrase: "wait" },
    });
    expect(second.vars["demo.dust"]).toBe(2);
  });

  it("on flag edge fires only after set earlier this evaluation", () => {
    const quest = parseQuestFile({
      name: "demo",
      rules: [
        { id: "set", when: { holds: 1 }, then: [{ setFlag: "demo.x" }] },
        {
          id: "edge",
          on: { flag: "demo.x" },
          when: { flag: "demo.x" },
          then: [{ grantBadge: "demo.x" }],
        },
      ],
    });
    const r = evaluateQuests({
      quests: [quest],
      flags: {},
      badges: [],
      predContext: {
        inventoryIds: new Set([1]),
        artefactTags: new Map(),
        scenesOwned: 0,
      },
    });
    expect(r.badges).toEqual(["demo.x"]);
  });

  it("does not throw when a rule when-clause is malformed at eval", () => {
    const result = evaluateQuests({
      quests: [
        {
          name: "broken",
          rules: [
            { id: "bad", when: { all: "nope" as unknown as [] }, then: [{ setFlag: "broken.x" }] },
            { id: "ok", when: { holds: 1 }, then: [{ setFlag: "broken.y" }] },
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

  it("applyThenEffects no-ops same flag value", () => {
    const { flagChanges } = applyThenEffects({ "q.a": true }, {}, [{ setFlag: "q.a" }], {
      inventoryIds: new Set(),
      canGiveArtefact: () => false,
    });
    expect(flagChanges).toEqual([]);
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
    expect(matchAlchemyRecipe([blocked, ok], [1, 2], tags, (r) => !r.author)?.id).toBe("ok");
  });
});
