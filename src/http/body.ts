import type { Context } from "hono";

/** Form fields that keep every value (multi-select / repeated checkboxes). */
const MULTI_VALUE_KEYS = new Set([
  "exitId",
  "exitIds",
  "exit",
  "artefactId",
  "artefactIds",
]);

/**
 * Read JSON or form-urlencoded/multipart into a flat record.
 * Multi-value keys keep every string; other repeated fields keep the last
 * (hidden+checkbox pairs).
 */
export async function readRequestBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await c.req.json()) as Record<string, unknown>;
  }
  const form = await c.req.parseBody({ all: true });
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (Array.isArray(v)) {
      const strings = v.filter((item): item is string => typeof item === "string");
      if (MULTI_VALUE_KEYS.has(k)) {
        out[k] = strings.length <= 1 ? (strings[0] ?? "") : strings;
      } else {
        out[k] = strings.at(-1) ?? String(v.at(-1));
      }
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

export function parseEnabledFlag(raw: unknown): boolean {
  return (
    raw === true ||
    raw === 1 ||
    String(raw).toLowerCase() === "true" ||
    String(raw) === "1" ||
    String(raw).toLowerCase() === "on"
  );
}

export function isTruthy(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}
