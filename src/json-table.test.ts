import { describe, expect, it } from "vitest";
import {
  getJsonTableSchema,
  jsonKindFromFieldName,
  listJsonTableKinds,
  registerJsonFieldKind,
  registerJsonTableSchema,
} from "./json-table.js";

describe("jsonKindFromFieldName", () => {
  it("maps known field names", () => {
    expect(jsonKindFromFieldName("detailsJson")).toBe("details");
    expect(jsonKindFromFieldName("detailWhenJson")).toBe("detailWhen");
    expect(jsonKindFromFieldName("grantsJson")).toBe("grants");
    expect(jsonKindFromFieldName("deniesJson")).toBe("denies");
    expect(jsonKindFromFieldName("recipesJson")).toBe("alchemy");
    expect(jsonKindFromFieldName("other")).toBeUndefined();
  });

  it("allows registering further field mappings", () => {
    registerJsonFieldKind("widgetsJson", "widgets");
    expect(jsonKindFromFieldName("widgetsJson")).toBe("widgets");
  });
});

describe("details schema", () => {
  const schema = getJsonTableSchema("details")!;

  it("round-trips object rows and preserves key order", () => {
    const loaded = schema.toRows({ card: "Hello", window: "Rain" });
    expect(loaded).toEqual({
      ok: true,
      rows: [
        { key: "card", value: "Hello" },
        { key: "window", value: "Rain" },
      ],
    });
    const saved = schema.fromRows([
      { key: "window", value: "Rain" },
      { key: "card", value: "Hello" },
    ]);
    expect(saved).toEqual({
      ok: true,
      value: { window: "Rain", card: "Hello" },
    });
    expect(Object.keys((saved as { value: object }).value)).toEqual(["window", "card"]);
  });

  it("rejects arrays, blank keys, and duplicates", () => {
    expect(schema.toRows([]).ok).toBe(false);
    expect(schema.fromRows([{ key: "  ", value: "x" }])).toMatchObject({ ok: false });
    expect(
      schema.fromRows([
        { key: "a", value: "1" },
        { key: "a", value: "2" },
      ]),
    ).toMatchObject({ ok: false });
  });
});

describe("detailWhen schema", () => {
  const schema = getJsonTableSchema("detailWhen")!;

  it("round-trips flag refs keyed by detail name", () => {
    const loaded = schema.toRows({ secret: "q.secret", "old door": "not.q.open" });
    expect(loaded).toEqual({
      ok: true,
      rows: [
        { key: "secret", value: "q.secret" },
        { key: "old door", value: "not.q.open" },
      ],
    });
    expect(schema.fromRows([{ key: "secret", value: "q.secret" }])).toEqual({
      ok: true,
      value: { secret: "q.secret" },
    });
  });

  it("uses Flag condition as the value column", () => {
    expect(schema.title).toBe("Detail conditions");
    expect(schema.columns.map((c) => c.label)).toEqual(["Key", "Flag condition"]);
    expect(schema.columns[1]).toMatchObject({ type: "text" });
  });
});

describe("grants schema", () => {
  const schema = getJsonTableSchema("grants")!;

  it("round-trips grants and drops blank rows", () => {
    const loaded = schema.toRows([{ who: "bob", rights: ["read", "edit"] }]);
    expect(loaded).toEqual({
      ok: true,
      rows: [{ who: "bob", rights: ["read", "edit"] }],
    });
    expect(
      schema.fromRows([
        { who: "bob", rights: ["manage"] },
        { who: "", rights: [] },
      ]),
    ).toEqual({
      ok: true,
      value: [{ who: "bob", rights: ["manage"] }],
    });
  });

  it("requires who and at least one right", () => {
    expect(schema.fromRows([{ who: "", rights: ["read"] }])).toMatchObject({ ok: false });
    expect(schema.fromRows([{ who: "bob", rights: [] }])).toMatchObject({ ok: false });
  });
});

describe("denies schema", () => {
  const schema = getJsonTableSchema("denies")!;

  it("omits rights when none selected (deny all)", () => {
    expect(schema.fromRows([{ who: "carol", rights: [] }])).toEqual({
      ok: true,
      value: [{ who: "carol" }],
    });
    expect(schema.fromRows([{ who: "bob", rights: ["edit"] }])).toEqual({
      ok: true,
      value: [{ who: "bob", rights: ["edit"] }],
    });
  });

  it("loads omit/empty rights as empty checkbox set", () => {
    expect(schema.toRows([{ who: "carol" }])).toEqual({
      ok: true,
      rows: [{ who: "carol", rights: [] }],
    });
  });
});

describe("alchemy schema", () => {
  const schema = getJsonTableSchema("alchemy")!;

  it("round-trips ids, tags, and multi gives", () => {
    const loaded = schema.toRows([
      {
        id: "mix",
        inputs: [1, { tag: "citrus" }, 3],
        gives: [9, 10],
        ok: "Nice.",
      },
    ]);
    expect(loaded).toEqual({
      ok: true,
      rows: [
        {
          id: "mix",
          inputs: "1, citrus, 3",
          gives: "9, 10",
          ok: "Nice.",
        },
      ],
    });
    expect(
      schema.fromRows([
        {
          id: "mix",
          inputs: "1, citrus, 3",
          gives: "9, 10",
          ok: "Nice.",
        },
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          id: "mix",
          inputs: [1, { tag: "citrus" }, 3],
          gives: [9, 10],
          ok: "Nice.",
        },
      ],
    });
  });

  it("rejects fewer than two inputs", () => {
    expect(
      schema.fromRows([{ id: "x", inputs: "1", gives: "2", ok: "" }]),
    ).toMatchObject({ ok: false });
  });
});

describe("schema registry", () => {
  it("lists built-in kinds and accepts new schemas", () => {
    expect(listJsonTableKinds()).toEqual(
      expect.arrayContaining(["details", "detailWhen", "grants", "denies", "alchemy"]),
    );
    registerJsonTableSchema({
      kind: "widgets",
      title: "Widgets",
      emptyValue: [],
      columns: [{ key: "id", label: "Id", type: "text" }],
      toRows: (parsed) =>
        Array.isArray(parsed)
          ? { ok: true, rows: parsed.map((id) => ({ id: String(id) })) }
          : { ok: false, error: "array required" },
      fromRows: (rows) => ({ ok: true, value: rows.map((r) => String(r.id ?? "")) }),
    });
    expect(getJsonTableSchema("widgets")?.title).toBe("Widgets");
  });
});
