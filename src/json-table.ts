/**
 * Schema registry for shaped JSON table editors.
 * Add a schema + field-name mapping to support a new dataset; no free-form JSON.
 */

import type { Right } from "./model/types.js";
import { ALL_RIGHTS } from "./model/types.js";

export type JsonTableColumn =
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "prose"; rows?: number }
  | { key: string; label: string; type: "rights"; allowEmpty: boolean };

export type JsonTableRow = Record<string, unknown>;

export type JsonTableResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type JsonTableRowsResult =
  | { ok: true; rows: JsonTableRow[] }
  | { ok: false; error: string };

export interface JsonTableSchema {
  kind: string;
  title: string;
  columns: JsonTableColumn[];
  /** Value used when the textarea is empty. */
  emptyValue: unknown;
  /** Turn parsed JSON into editable rows. */
  toRows(parsed: unknown): JsonTableRowsResult;
  /** Turn rows back into the JSON value written to the textarea. */
  fromRows(rows: JsonTableRow[]): JsonTableResult;
}

const schemas = new Map<string, JsonTableSchema>();

/** Register (or replace) a table schema. Used by built-ins and future datasets. */
export function registerJsonTableSchema(schema: JsonTableSchema): void {
  schemas.set(schema.kind, schema);
}

export function getJsonTableSchema(kind: string | undefined): JsonTableSchema | undefined {
  if (!kind) return undefined;
  return schemas.get(kind);
}

export function listJsonTableKinds(): string[] {
  return [...schemas.keys()];
}

/** Map known form field names to schema kinds. Extend when adding datasets. */
const FIELD_NAME_TO_KIND: Record<string, string> = {
  detailsJson: "details",
  detailWhenJson: "detailWhen",
  grantsJson: "grants",
  deniesJson: "denies",
  recipesJson: "alchemy",
};

export function jsonKindFromFieldName(name: string): string | undefined {
  return FIELD_NAME_TO_KIND[name];
}

/** Register a field name → kind mapping for a new shaped dataset. */
export function registerJsonFieldKind(fieldName: string, kind: string): void {
  FIELD_NAME_TO_KIND[fieldName] = kind;
}

export function dataJsonKindAttr(name: string): string {
  const kind = jsonKindFromFieldName(name);
  return kind ? ` data-json-kind="${kind}"` : "";
}

function asRights(raw: unknown): Right[] {
  if (!Array.isArray(raw)) return [];
  const out: Right[] = [];
  for (const r of raw) {
    const s = String(r);
    if (s === "read" || s === "edit" || s === "manage") out.push(s);
  }
  return out;
}

function stringMapToRows(parsed: unknown, objectError: string): JsonTableRowsResult {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: objectError };
  }
  const rows: JsonTableRow[] = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: String(value ?? ""),
  }));
  return { ok: true, rows };
}

function stringMapFromRows(rows: JsonTableRow[], item: string): JsonTableResult {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row.key ?? "").trim();
    if (!key) return { ok: false, error: `Each ${item} needs a non-empty key.` };
    if (seen.has(key)) return { ok: false, error: `Duplicate ${item} key: ${key}` };
    seen.add(key);
    out[key] = String(row.value ?? "");
  }
  return { ok: true, value: out };
}

function aclToRows(parsed: unknown, label: string): JsonTableRowsResult {
  if (!Array.isArray(parsed)) {
    return { ok: false, error: `${label} must be a JSON array.` };
  }
  const rows: JsonTableRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `${label} entries must be objects with who and rights.` };
    }
    const obj = item as Record<string, unknown>;
    rows.push({
      who: String(obj.who ?? ""),
      rights: asRights(obj.rights),
    });
  }
  return { ok: true, rows };
}

function grantsFromRows(rows: JsonTableRow[]): JsonTableResult {
  const out: Array<{ who: string; rights: Right[] }> = [];
  for (const row of rows) {
    const who = String(row.who ?? "").trim();
    const rights = asRights(row.rights);
    if (!who && rights.length === 0) continue;
    if (!who) return { ok: false, error: "Each grant needs a uid (username or *)." };
    if (!rights.length) return { ok: false, error: `Grant for ${who} needs at least one right.` };
    out.push({ who, rights });
  }
  return { ok: true, value: out };
}

function deniesFromRows(rows: JsonTableRow[]): JsonTableResult {
  const out: Array<{ who: string; rights?: Right[] }> = [];
  for (const row of rows) {
    const who = String(row.who ?? "").trim();
    const rights = asRights(row.rights);
    if (!who && rights.length === 0) continue;
    if (!who) return { ok: false, error: "Each deny needs a uid (username or *)." };
    out.push(rights.length ? { who, rights } : { who });
  }
  return { ok: true, value: out };
}

registerJsonTableSchema({
  kind: "details",
  title: "Details",
  emptyValue: {},
  columns: [
    { key: "key", label: "Key", type: "text", placeholder: "slug" },
    { key: "value", label: "Description", type: "prose", rows: 4 },
  ],
  toRows: (parsed) => stringMapToRows(parsed, "Details must be a JSON object of named texts."),
  fromRows: (rows) => stringMapFromRows(rows, "detail"),
});

registerJsonTableSchema({
  kind: "detailWhen",
  title: "Detail conditions",
  emptyValue: {},
  columns: [
    { key: "key", label: "Key", type: "text", placeholder: "slug" },
    { key: "value", label: "Flag condition", type: "text", placeholder: "quest.flag or not.quest.flag" },
  ],
  toRows: (parsed) => stringMapToRows(parsed, "Detail conditions must be a JSON object of named flags."),
  fromRows: (rows) => stringMapFromRows(rows, "detail condition"),
});

registerJsonTableSchema({
  kind: "grants",
  title: "Grants",
  emptyValue: [],
  columns: [
    { key: "who", label: "uid", type: "text", placeholder: "username or *" },
    { key: "rights", label: "Rights", type: "rights", allowEmpty: false },
  ],
  toRows: (parsed) => aclToRows(parsed, "Grants"),
  fromRows: grantsFromRows,
});

registerJsonTableSchema({
  kind: "denies",
  title: "Denies",
  emptyValue: [],
  columns: [
    { key: "who", label: "uid", type: "text", placeholder: "username or *" },
    { key: "rights", label: "Rights", type: "rights", allowEmpty: true },
  ],
  toRows: (parsed) => aclToRows(parsed, "Denies"),
  fromRows: deniesFromRows,
});

function formatAlchemyInput(inp: unknown): string {
  if (typeof inp === "number" && Number.isFinite(inp)) return String(inp);
  if (inp && typeof inp === "object" && "tag" in inp) {
    return String((inp as { tag: unknown }).tag ?? "").trim();
  }
  return String(inp ?? "").trim();
}

function parseAlchemyInputToken(raw: string): number | { tag: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const tagMatch = s.match(/^tag:\s*(.+)$/i);
  if (tagMatch) return { tag: tagMatch[1]!.trim() };
  return { tag: s };
}

function alchemyInputsToText(inputs: unknown): string {
  if (!Array.isArray(inputs)) return "";
  return inputs.map(formatAlchemyInput).filter(Boolean).join(", ");
}

function alchemyGivesToText(gives: unknown): string {
  if (Array.isArray(gives)) return gives.map(String).join(", ");
  if (gives === undefined || gives === null) return "";
  return String(gives);
}

function alchemyToRows(parsed: unknown): JsonTableRowsResult {
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Alchemy recipes must be a JSON array." };
  }
  const rows: JsonTableRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each recipe must be an object." };
    }
    const o = item as Record<string, unknown>;
    rows.push({
      id: String(o.id ?? ""),
      inputs: alchemyInputsToText(o.inputs),
      gives: alchemyGivesToText(o.gives),
      ok: String(o.ok ?? ""),
    });
  }
  return { ok: true, rows };
}

function alchemyFromRows(rows: JsonTableRow[]): JsonTableResult {
  const out: Array<{
    id: string;
    inputs: Array<number | { tag: string }>;
    gives: number | number[];
    ok?: string;
  }> = [];

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const inputsText = String(row.inputs ?? "").trim();
    const givesText = String(row.gives ?? "").trim();
    const ok = String(row.ok ?? "").trim();
    if (!id && !inputsText && !givesText && !ok) continue;
    if (!id) return { ok: false, error: "Each recipe needs an id." };
    if (!inputsText) return { ok: false, error: `Recipe ${id}: inputs required (2+).` };
    if (!givesText) return { ok: false, error: `Recipe ${id}: gives required.` };

    const inputs: Array<number | { tag: string }> = [];
    for (const part of inputsText.split(",")) {
      const token = parseAlchemyInputToken(part);
      if (!token) continue;
      if (typeof token === "object" && !token.tag) {
        return { ok: false, error: `Recipe ${id}: empty tag in inputs.` };
      }
      inputs.push(token);
    }
    if (inputs.length < 2) {
      return { ok: false, error: `Recipe ${id}: inputs need at least two entries.` };
    }

    const giveParts = givesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const giveIds = giveParts.map(Number);
    if (!giveIds.length || giveIds.some((n) => !Number.isFinite(n))) {
      return { ok: false, error: `Recipe ${id}: gives must be artefact id number(s).` };
    }

    const recipe: (typeof out)[number] = {
      id,
      inputs,
      gives: giveIds.length === 1 ? giveIds[0]! : giveIds,
    };
    if (ok) recipe.ok = ok;
    out.push(recipe);
  }
  return { ok: true, value: out };
}

registerJsonTableSchema({
  kind: "alchemy",
  title: "Alchemy recipes",
  emptyValue: [],
  columns: [
    { key: "id", label: "Id", type: "text", placeholder: "sunset-cocktail" },
    {
      key: "inputs",
      label: "Inputs",
      type: "text",
      placeholder: "12, spirit, 44",
    },
    { key: "gives", label: "Gives", type: "text", placeholder: "120" },
    { key: "ok", label: "Ok prose", type: "prose", rows: 2 },
  ],
  toRows: alchemyToRows,
  fromRows: alchemyFromRows,
});

export { ALL_RIGHTS };
