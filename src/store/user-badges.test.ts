import { describe, expect, it } from "vitest";
import { mergeGrantedBadges, parseUserBadges } from "./user-badges.js";

describe("parseUserBadges", () => {
  it("reads objects with optional grantTime", () => {
    expect(
      parseUserBadges([
        { badge: "builders.hamlet", grantTime: "2026-08-10T20:00:00.000Z" },
        { badge: "demo.winner" },
      ]),
    ).toEqual([
      { badge: "builders.hamlet", grantTime: "2026-08-10T20:00:00.000Z" },
      { badge: "demo.winner" },
    ]);
  });

  it("skips invalid entries and duplicate ids", () => {
    expect(
      parseUserBadges([
        { badge: "a.one", grantTime: "2020-01-01T00:00:00.000Z" },
        { badge: "a.one" },
        { badge: "  " },
        { grantTime: "2020-01-01T00:00:00.000Z" },
        "legacy.string",
        null,
        12,
        { badge: "a.two", grantTime: "  " },
      ]),
    ).toEqual([
      { badge: "a.one", grantTime: "2020-01-01T00:00:00.000Z" },
      { badge: "a.two" },
    ]);
  });

  it("returns empty for a non-array", () => {
    expect(parseUserBadges({ badge: "x" })).toEqual([]);
    expect(parseUserBadges(undefined)).toEqual([]);
  });
});

describe("mergeGrantedBadges", () => {
  it("stamps now only on newly granted ids", () => {
    const prior = [{ badge: "old.one", grantTime: "2020-01-01T00:00:00.000Z" }, { badge: "old.bare" }];
    expect(mergeGrantedBadges(prior, ["old.one", "old.bare", "new.two"], "2026-08-17T12:00:00.000Z")).toEqual([
      { badge: "old.one", grantTime: "2020-01-01T00:00:00.000Z" },
      { badge: "old.bare" },
      { badge: "new.two", grantTime: "2026-08-17T12:00:00.000Z" },
    ]);
  });
});
