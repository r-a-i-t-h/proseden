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
  grantsJson: "grants",
  deniesJson: "denies",
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

function detailsToRows(parsed: unknown): JsonTableRowsResult {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Details must be a JSON object of named texts." };
  }
  const rows: JsonTableRow[] = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: String(value ?? ""),
  }));
  return { ok: true, rows };
}

function detailsFromRows(rows: JsonTableRow[]): JsonTableResult {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row.key ?? "").trim();
    if (!key) return { ok: false, error: "Each detail needs a non-empty key." };
    if (seen.has(key)) return { ok: false, error: `Duplicate detail key: ${key}` };
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
  toRows: detailsToRows,
  fromRows: detailsFromRows,
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

export { ALL_RIGHTS };
