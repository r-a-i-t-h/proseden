import { escapeAttr } from "./escape.js";
import { escapeHtml } from "./prose.js";

/** Coarse relative age for “last seen” (same wording as live admin). */
export function relativeAge(iso: string, nowMs = Date.now()): string {
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Relative age with hover tooltip showing the absolute ISO timestamp. */
export function relativeAgeHtml(iso: string, nowMs = Date.now()): string {
  const age = relativeAge(iso, nowMs);
  const safeIso = escapeAttr(iso);
  if (age === iso) {
    return `<time datetime="${safeIso}">${escapeHtml(iso)}</time>`;
  }
  return `<time datetime="${safeIso}" title="${safeIso}">${escapeHtml(age)}</time>`;
}
