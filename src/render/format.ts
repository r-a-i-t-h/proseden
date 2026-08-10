import type { Context } from "hono";

export type OutputFormat = "html" | "text";

/** Query keys reserved for protocol concerns — not treated as detail names. */
const RESERVED_QUERY_KEYS = new Set(["format", "from"]);

export function negotiateFormat(c: Context): OutputFormat {
  const q = c.req.query("format")?.toLowerCase();
  if (q === "text" || q === "plain") return "text";
  if (q === "html") return "html";

  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/plain") && !accept.includes("text/html")) {
    return "text";
  }
  if (accept.includes("text/html")) return "html";
  // curl default Accept is */* — prefer text for tooling friendliness when no HTML hinted
  if (accept === "*/*" || accept === "") {
    const ua = c.req.header("user-agent") ?? "";
    if (/curl|wget|httpie/i.test(ua)) return "text";
  }
  return "html";
}

/** Detail name is the query key itself, e.g. `/s/1?card` or `/s/1?card&format=text`. */
export function queryDetailName(c: Context): string | undefined {
  const url = new URL(c.req.url);
  for (const key of url.searchParams.keys()) {
    if (!RESERVED_QUERY_KEYS.has(key)) return key;
  }
  return undefined;
}
