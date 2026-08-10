import type { Context } from "hono";

export type OutputFormat = "html" | "text";

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
