import { describe, expect, it } from "vitest";
import {
  formatAccessSummary,
  grantedRights,
  grantCovers,
  matchesDeny,
  normalizeDenies,
  normalizeGrants,
  normalizeRightsList,
  parseAccessPayload,
  rightsCover,
  stripLegacyInvites,
} from "../src/access/acl.js";

describe("rightsCover", () => {
  it("treats manage as covering edit and read", () => {
    expect(rightsCover(["manage"], "manage")).toBe(true);
    expect(rightsCover(["manage"], "edit")).toBe(true);
    expect(rightsCover(["manage"], "read")).toBe(true);
  });

  it("treats edit as covering read but not manage", () => {
    expect(rightsCover(["edit"], "edit")).toBe(true);
    expect(rightsCover(["edit"], "read")).toBe(true);
    expect(rightsCover(["edit"], "manage")).toBe(false);
  });

  it("treats read as covering only read", () => {
    expect(rightsCover(["read"], "read")).toBe(true);
    expect(rightsCover(["read"], "edit")).toBe(false);
    expect(rightsCover(["read"], "manage")).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(rightsCover([], "read")).toBe(false);
  });
});

describe("matchesDeny", () => {
  it("returns false when denies are missing or empty", () => {
    expect(matchesDeny(undefined, "alice", "read")).toBe(false);
    expect(matchesDeny([], "alice", "read")).toBe(false);
  });

  it("denies all rights when rights are omitted or empty", () => {
    expect(matchesDeny([{ who: "alice" }], "alice", "read")).toBe(true);
    expect(matchesDeny([{ who: "alice" }], "alice", "manage")).toBe(true);
    expect(matchesDeny([{ who: "alice", rights: [] }], "alice", "edit")).toBe(true);
  });

  it("denies only listed rights", () => {
    const denies = [{ who: "alice", rights: ["edit" as const] }];
    expect(matchesDeny(denies, "alice", "edit")).toBe(true);
    expect(matchesDeny(denies, "alice", "read")).toBe(false);
  });

  it("ignores denies for other users", () => {
    expect(matchesDeny([{ who: "bob" }], "alice", "read")).toBe(false);
  });
});

describe("grantedRights / grantCovers", () => {
  const grants = [
    { who: "alice", rights: ["read" as const] },
    { who: "bob", rights: ["edit" as const] },
    { who: "*", rights: ["read" as const] },
  ];

  it("collects named grants and wildcard grants", () => {
    expect(grantedRights(grants, "alice").sort()).toEqual(["read"]);
    expect(grantedRights(grants, "bob").sort()).toEqual(["edit", "read"]);
    expect(grantedRights(grants, "carol")).toEqual(["read"]);
    expect(grantedRights(grants, undefined)).toEqual(["read"]);
  });

  it("returns empty when grants are missing", () => {
    expect(grantedRights(undefined, "alice")).toEqual([]);
    expect(grantedRights([], "alice")).toEqual([]);
  });

  it("checks coverage including hierarchy", () => {
    expect(grantCovers([{ who: "alice", rights: ["manage"] }], "alice", "edit")).toBe(true);
    expect(grantCovers([{ who: "alice", rights: ["read"] }], "alice", "edit")).toBe(false);
    expect(grantCovers([{ who: "*", rights: ["edit"] }], undefined, "read")).toBe(true);
  });
});

describe("normalizeRightsList", () => {
  it("keeps only valid rights", () => {
    expect(normalizeRightsList(["read", "edit", "manage", "admin", 1])).toEqual([
      "read",
      "edit",
      "manage",
    ]);
  });

  it("returns empty for non-arrays", () => {
    expect(normalizeRightsList("read")).toEqual([]);
    expect(normalizeRightsList(null)).toEqual([]);
  });
});

describe("normalizeGrants", () => {
  it("parses grant objects", () => {
    expect(
      normalizeGrants([{ who: "alice", rights: ["read", "edit"] }, { who: "", rights: ["read"] }]),
    ).toEqual([{ who: "alice", rights: ["read", "edit"] }]);
  });

  it("skips grants with no valid rights", () => {
    expect(normalizeGrants([{ who: "alice", rights: ["admin"] }])).toEqual([]);
  });

  it("migrates legacy string invites to read grants", () => {
    expect(normalizeGrants(undefined, ["alice", "bob"])).toEqual([
      { who: "alice", rights: ["read"] },
      { who: "bob", rights: ["read"] },
    ]);
    expect(normalizeGrants(["carol", "dave"])).toEqual([
      { who: "carol", rights: ["read"] },
      { who: "dave", rights: ["read"] },
    ]);
  });

  it("prefers grant objects over legacy invites when present", () => {
    expect(
      normalizeGrants([{ who: "alice", rights: ["edit"] }], ["bob"]),
    ).toEqual([{ who: "alice", rights: ["edit"] }]);
  });

  it("falls back to invites when grants array is empty", () => {
    expect(normalizeGrants([], ["alice"])).toEqual([{ who: "alice", rights: ["read"] }]);
  });
});

describe("normalizeDenies", () => {
  it("parses deny objects with and without rights", () => {
    expect(
      normalizeDenies([
        { who: "alice" },
        { who: "bob", rights: ["edit"] },
        { who: "carol", rights: [] },
        { who: "", rights: ["read"] },
      ]),
    ).toEqual([{ who: "alice" }, { who: "bob", rights: ["edit"] }, { who: "carol" }]);
  });

  it("migrates legacy string[] to deny-all entries", () => {
    expect(normalizeDenies(["alice", "bob"])).toEqual([{ who: "alice" }, { who: "bob" }]);
  });

  it("returns empty for missing input", () => {
    expect(normalizeDenies(undefined)).toEqual([]);
    expect(normalizeDenies([])).toEqual([]);
  });
});

describe("parseAccessPayload", () => {
  it("parses grants and denies arrays", () => {
    expect(
      parseAccessPayload({
        grants: [{ who: "alice", rights: ["read"] }],
        denies: [{ who: "bob" }],
      }),
    ).toEqual({
      grants: [{ who: "alice", rights: ["read"] }],
      denies: [{ who: "bob" }],
    });
  });

  it("parses JSON string fields", () => {
    expect(
      parseAccessPayload({
        grantsJson: '[{"who":"alice","rights":["edit"]}]',
        deniesJson: '[{"who":"bob","rights":["read"]}]',
      }),
    ).toEqual({
      grants: [{ who: "alice", rights: ["edit"] }],
      denies: [{ who: "bob", rights: ["read"] }],
    });
  });

  it("allows real line breaks inside JSON string values", () => {
    expect(
      parseAccessPayload({
        grantsJson: `[
  { "who": "alice", "rights": ["edit"] }
]`,
        deniesJson: `[{"who": "bob
jr"}]`,
      }),
    ).toEqual({
      grants: [{ who: "alice", rights: ["edit"] }],
      denies: [{ who: "bob\njr" }],
    });
  });

  it("treats blank JSON strings as empty lists", () => {
    expect(parseAccessPayload({ grantsJson: "  ", deniesJson: "" })).toEqual({
      grants: [],
      denies: [],
    });
  });

  it("omits keys that were not provided", () => {
    expect(parseAccessPayload({})).toEqual({});
    expect(parseAccessPayload({ grants: [] })).toEqual({ grants: [] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAccessPayload({ grantsJson: "{not-json" })).toThrow();
  });
});

describe("formatAccessSummary", () => {
  it("formats grants and denies", () => {
    expect(
      formatAccessSummary(
        [{ who: "alice", rights: ["read", "edit"] }],
        [{ who: "bob" }, { who: "carol", rights: ["manage"] }],
      ),
    ).toBe(
      [
        "Grants:",
        "  alice [read, edit]",
        "Denies:",
        "  bob [all]",
        "  carol [manage]",
      ].join("\n"),
    );
  });

  it("shows none when empty", () => {
    expect(formatAccessSummary([], [])).toBe("Grants:\n  (none)\nDenies:\n  (none)");
    expect(formatAccessSummary(undefined, undefined)).toBe(
      "Grants:\n  (none)\nDenies:\n  (none)",
    );
  });
});

describe("stripLegacyInvites", () => {
  it("removes invites while keeping grants", () => {
    expect(
      stripLegacyInvites({
        id: 1,
        invites: ["alice"],
        grants: [{ who: "bob", rights: ["read"] }],
      }),
    ).toEqual({
      id: 1,
      grants: [{ who: "bob", rights: ["read"] }],
    });
  });
});
