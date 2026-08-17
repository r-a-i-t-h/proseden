import { describe, expect, it } from "vitest";
import type { SceneRecord } from "../model/types.js";
import type { FlagValue } from "../model/logic.js";
import {
  evaluateFlagRef,
  gateFacts,
  gateFactsFor,
  parseOptionalFlagRef,
} from "./pred.js";
import {
  artefactVisible,
  exitAllowed,
  resolveArtefactDetails,
  resolveSceneDetails,
  sceneAllowed,
  visibleArtefacts,
  visibleExits,
} from "./world-view.js";

describe("FlagRef", () => {
  it("unprefixed refs are the flag scheme; flag: is optional", () => {
    const open = gateFacts({ flags: { "q.open": true } });
    expect(evaluateFlagRef("q.open", gateFacts())).toBe(false);
    expect(evaluateFlagRef("q.open", open)).toBe(true);
    expect(evaluateFlagRef("flag:q.open", gateFacts())).toBe(false);
    expect(evaluateFlagRef("flag:q.open", open)).toBe(true);
    expect(evaluateFlagRef("not.q.open", gateFacts())).toBe(true);
    expect(evaluateFlagRef("not.q.open", open)).toBe(false);
    expect(evaluateFlagRef("flag:not.q.open", gateFacts())).toBe(true);
    expect(evaluateFlagRef("flag:not.q.open", open)).toBe(false);
    expect(evaluateFlagRef("q.open", gateFacts({ flags: { "q.open": false } }))).toBe(false);
  });

  it("empty refs are ungated", () => {
    expect(evaluateFlagRef(undefined, gateFacts())).toBe(true);
    expect(evaluateFlagRef("", gateFacts())).toBe(true);
    expect(evaluateFlagRef("   ", gateFacts())).toBe(true);
  });

  it("holds: checks current inventory", () => {
    const holding = gateFacts({ inventoryIds: new Set([1]) });
    expect(evaluateFlagRef("holds:1", gateFacts())).toBe(false);
    expect(evaluateFlagRef("holds:1", holding)).toBe(true);
    expect(evaluateFlagRef("holds:not.1", gateFacts())).toBe(true);
    expect(evaluateFlagRef("holds:not.1", holding)).toBe(false);
    expect(evaluateFlagRef("holds:2", holding)).toBe(false);
    expect(evaluateFlagRef("holds:nope", holding)).toBe(false);
    expect(evaluateFlagRef("holds:0", holding)).toBe(false);
    expect(evaluateFlagRef("holds:01", holding)).toBe(false);
    expect(evaluateFlagRef("holds:1.5", holding)).toBe(false);
    expect(evaluateFlagRef("holds:", holding)).toBe(false);
    expect(evaluateFlagRef("holds:not.", holding)).toBe(false);
  });

  it("badge: checks current badges", () => {
    const badged = gateFacts({ badges: new Set(["demo.x"]) });
    expect(evaluateFlagRef("badge:demo.x", gateFacts())).toBe(false);
    expect(evaluateFlagRef("badge:demo.x", badged)).toBe(true);
    expect(evaluateFlagRef("badge:not.demo.x", gateFacts())).toBe(true);
    expect(evaluateFlagRef("badge:not.demo.x", badged)).toBe(false);
    expect(evaluateFlagRef("badge:", badged)).toBe(false);
    expect(evaluateFlagRef("badge:not.", badged)).toBe(false);
  });

  it("unknown schemes are false (not flag ids)", () => {
    expect(evaluateFlagRef("atScene:5", gateFacts({ flags: { "atScene:5": true } }))).toBe(false);
    expect(evaluateFlagRef("holdsTag:key", gateFacts())).toBe(false);
    expect(evaluateFlagRef("Flag:q.open", gateFacts({ flags: { "q.open": true } }))).toBe(false);
    expect(evaluateFlagRef(":q.open", gateFacts({ flags: { "q.open": true } }))).toBe(false);
  });

  it("invert belongs on the payload, not in front of the scheme", () => {
    expect(evaluateFlagRef("not.holds:1", gateFacts())).toBe(false);
    expect(evaluateFlagRef("not.holds:1", gateFacts({ inventoryIds: new Set([1]) }))).toBe(false);
    expect(evaluateFlagRef("holds:not.1", gateFacts())).toBe(true);
  });

  it("trims scheme payloads", () => {
    const facts = gateFacts({
      flags: { "q.open": true },
      inventoryIds: new Set([12]),
      badges: new Set(["demo.x"]),
    });
    expect(evaluateFlagRef(" flag: q.open ", facts)).toBe(true);
    expect(evaluateFlagRef("holds: 12", facts)).toBe(true);
    expect(evaluateFlagRef("badge: demo.x", facts)).toBe(true);
  });

  it("parseOptionalFlagRef keeps unprefixed flags and scheme forms as written", () => {
    expect(parseOptionalFlagRef("q.open")).toBe("q.open");
    expect(parseOptionalFlagRef("flag:q.open")).toBe("flag:q.open");
    expect(parseOptionalFlagRef("holds:12")).toBe("holds:12");
    expect(parseOptionalFlagRef("badge:demo.x")).toBe("badge:demo.x");
    expect(parseOptionalFlagRef("  ")).toBeUndefined();
    expect(parseOptionalFlagRef("not.")).toBeUndefined();
  });

  it("gateFactsFor maps the reader; anonymous is empty", () => {
    const world = {
      getUserFlags: (name: string): Record<string, FlagValue> =>
        name === "bob" ? { "q.open": true } : {},
      getUserBadges: (name: string) => (name === "bob" ? [{ badge: "demo.x" }] : []),
    };
    expect(gateFactsFor(world, undefined)).toEqual(gateFacts());
    expect(gateFactsFor(world, { username: "bob", inventory: [{ artefactId: 12 }] })).toEqual(
      gateFacts({
        flags: { "q.open": true },
        inventoryIds: new Set([12]),
        badges: new Set(["demo.x"]),
      }),
    );
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
    expect(visibleExits(exits, gateFacts()).map((e) => e.nickname)).toEqual(["west"]);
    expect(
      visibleExits(exits, gateFacts({ flags: { "q.open": true } })).map((e) => e.nickname),
    ).toEqual(["east", "west"]);
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
    expect(visibleArtefacts(arts, gateFacts()).map((a) => a.id)).toEqual([1]);
    expect(
      visibleArtefacts(arts, gateFacts({ flags: { "q.show": true } })).map((a) => a.id),
    ).toEqual([1, 2]);
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
    expect(sceneAllowed(scene, gateFacts())).toBe(false);
    expect(sceneAllowed(scene, gateFacts({ flags: { "cellar.unlocked": true } }))).toBe(true);
  });

  it("sceneAllowed can gate on holds", () => {
    const scene = {
      id: 1,
      owner: "a",
      visibility: "public" as const,
      createdAt: "",
      modifiedAt: [],
      body: "x",
      details: {},
      when: "holds:12",
    } satisfies SceneRecord;
    expect(sceneAllowed(scene, gateFacts())).toBe(false);
    expect(sceneAllowed(scene, gateFacts({ inventoryIds: new Set([12]) }))).toBe(true);
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
    expect(resolveSceneDetails(scene, gateFacts())).toEqual({ passage: "hot" });
    expect(resolveSceneDetails(scene, gateFacts({ flags: { "q.cooled": true } }))).toEqual({
      passage: "cool",
    });
    expect(resolveSceneDetails(scene, gateFacts({ flags: { "q.secret": true } })).secret).toBe(
      "shh",
    );
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
    expect(resolveSceneDetails(scene, gateFacts())).toEqual({ passage: "hot" });
    expect(resolveSceneDetails(scene, gateFacts({ flags: { "q.cooled": true } }))).toEqual({
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
    expect(resolveArtefactDetails(art, gateFacts())).toEqual({ plain: "wood" });
    expect(resolveArtefactDetails(art, gateFacts({ flags: { "q.read": true } }))).toEqual({
      mark: "runes",
      plain: "wood",
    });
  });

  it("gates exits, artefacts, and details on holds and badge", () => {
    const exits = [
      {
        exitId: 1,
        nickname: "cellar",
        toSceneId: 2,
        createdAt: "",
        when: "holds:12",
        hidden: true,
      },
      {
        exitId: 2,
        nickname: "hall",
        toSceneId: 3,
        createdAt: "",
        when: "badge:demo.x",
      },
    ];
    expect(visibleExits(exits, gateFacts()).map((e) => e.nickname)).toEqual(["hall"]);
    expect(exitAllowed(exits[0]!, gateFacts())).toBe(false);
    expect(exitAllowed(exits[0]!, gateFacts({ inventoryIds: new Set([12]) }))).toBe(true);
    expect(
      visibleExits(exits, gateFacts({ inventoryIds: new Set([12]), badges: new Set(["demo.x"]) })).map(
        (e) => e.nickname,
      ),
    ).toEqual(["cellar", "hall"]);

    const art = {
      id: 2,
      owner: "a",
      homeSceneId: 1,
      tags: [],
      createdAt: "",
      modifiedAt: [],
      body: "",
      details: {},
      when: "badge:demo.x",
    };
    expect(artefactVisible(art, gateFacts())).toBe(false);
    expect(artefactVisible(art, gateFacts({ badges: new Set(["demo.x"]) }))).toBe(true);
    expect(visibleArtefacts([art], gateFacts()).map((a) => a.id)).toEqual([]);
    expect(visibleArtefacts([art], gateFacts({ badges: new Set(["demo.x"]) })).map((a) => a.id)).toEqual(
      [2],
    );

    const scene = {
      id: 1,
      owner: "a",
      visibility: "public" as const,
      createdAt: "",
      modifiedAt: [],
      body: "fixed",
      details: { plaque: "blank", inscription: "runes" },
      detailWhen: { inscription: "holds:12" },
    } satisfies SceneRecord;
    expect(resolveSceneDetails(scene, gateFacts())).toEqual({ plaque: "blank" });
    expect(resolveSceneDetails(scene, gateFacts({ inventoryIds: new Set([12]) }))).toEqual({
      plaque: "blank",
      inscription: "runes",
    });
  });
});
