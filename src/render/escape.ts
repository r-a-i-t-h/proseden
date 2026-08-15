import { escapeHtml } from "./prose.js";

/** Escape a value for use inside an HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
