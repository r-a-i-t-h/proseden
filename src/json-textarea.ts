/**
 * JSON textareas: allow real line breaks inside string values while editing.
 * Structural pretty-print whitespace stays as real newlines; only in-string
 * breaks are encoded as `\n` before JSON.parse.
 */

/** Pretty-print JSON for a textarea, with real newlines inside string values. */
export function formatJsonTextarea(value: unknown): string {
  return transformJsonStringNewlines(JSON.stringify(value, null, 2), "unescape");
}

/**
 * Show existing JSON source in a textarea without re-indenting.
 * Only turns in-string `\n` escapes into real line breaks for editing.
 */
export function displayJsonTextarea(text: string): string {
  return transformJsonStringNewlines(text.replace(/\n$/, ""), "unescape");
}

/** Rewrite in-string line breaks to `\n` so the text is valid for JSON.parse. */
export function prepareJsonTextarea(text: string): string {
  return transformJsonStringNewlines(text, "escape");
}

function transformJsonStringNewlines(text: string, mode: "escape" | "unescape"): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }

    if (escaped) {
      if (mode === "unescape" && ch === "n") out += "\n";
      else out += `\\${ch}`;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }

    if (mode === "escape" && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out += "\\n";
      continue;
    }

    out += ch;
  }

  if (escaped) out += "\\";
  return out;
}
