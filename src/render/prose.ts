/**
 * Lightweight prose adornments for scene/artefact bodies (Markdown-adjacent, not full MD).
 *
 * Inline: `_em_`, `*strong*`, `~strike~`, `` `code` ``,
 *         `[label](https://…)`, `[label](wikipedia:…)`, `[label](search:…)`
 * Block:  `# subtitle` → h3, `## minor` → h4, `---` → hr, `>` → blockquote
 *
 * Applied only when rendering HTML — raw seed/data files are unchanged.
 */

export function formatProse(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (!para.length) return;
    const html = formatInline(escapeHtml(para.join("\n"))).replace(/\n/g, "<br />");
    out.push(`<p>${html}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    const heading = line.match(/^(#{1,2})\s+(.+?)\s*$/);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      const tag = level === 1 ? "h3" : "h4";
      const cls = level === 1 ? "desc-heading" : "desc-heading-minor";
      out.push(
        `<${tag} class="${cls}">${formatInline(escapeHtml(heading[2]!))}</${tag}>`,
      );
      i += 1;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      flushPara();
      out.push("<hr />");
      i += 1;
      continue;
    }

    const quoteStart = line.match(/^>\s?(.*)$/);
    if (quoteStart) {
      flushPara();
      const quoteLines: string[] = [quoteStart[1]!];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.match(/^>\s?(.*)$/);
        if (!next) break;
        quoteLines.push(next[1]!);
        i += 1;
      }
      const inner = formatInline(escapeHtml(quoteLines.join("\n"))).replace(/\n/g, "<br />");
      out.push(`<blockquote><p>${inner}</p></blockquote>`);
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();
  return out.join("");
}

/** Apply inline adornments to already-escaped HTML text. */
export function formatInline(escaped: string): string {
  const slots: string[] = [];
  const park = (html: string) => {
    slots.push(html);
    return `\0${slots.length - 1}\0`;
  };

  // Park code spans so link/emphasis markers inside stay literal.
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => park(`<code>${code}</code>`));

  s = rewriteLinks(s, (label, dest) => {
    const href = resolveLinkHref(unescapeHtml(dest));
    if (!href) return label;
    return park(
      `<a href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank">${formatMarkers(label)}</a>`,
    );
  });

  s = formatMarkers(s);
  return s.replace(/\0(\d+)\0/g, (_m, idx: string) => slots[Number(idx)]!);
}

/** Rewrite `[label](dest)` spans; dest may contain balanced parentheses. */
function rewriteLinks(text: string, replace: (label: string, dest: string) => string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const closeLabel = text.indexOf("]", open + 1);
    const newline = text.indexOf("\n", open);
    if (
      closeLabel === -1 ||
      text[closeLabel + 1] !== "(" ||
      (newline !== -1 && newline < closeLabel)
    ) {
      out += "[";
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = closeLabel + 2;
    while (j < text.length && depth > 0) {
      const ch = text[j]!;
      if (ch === "\n") break;
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      j += 1;
    }
    if (depth !== 0) {
      out += "[";
      i = open + 1;
      continue;
    }
    const label = text.slice(open + 1, closeLabel);
    const dest = text.slice(closeLabel + 2, j - 1);
    out += replace(label, dest);
    i = j;
  }
  return out;
}

function formatMarkers(text: string): string {
  let s = text.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "<em>$1</em>");
  s = s.replace(/~([^~\n]+)~/g, "<s>$1</s>");
  return s;
}

/**
 * Resolve a Markdown link destination to an href.
 * Allows http(s) URLs and the wikipedia/search shortcuts; rejects other schemes.
 */
export function resolveLinkHref(dest: string): string | null {
  const target = dest.trim();
  if (!target) return null;

  const curated = target.match(/^(wikipedia|search):([\s\S]*)$/i);
  if (curated) return expandCuratedLink(curated[1]!.toLowerCase(), curated[2]!.trim());

  if (!/^https?:\/\//i.test(target)) return null;
  try {
    const url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Expand curated link schemes; returns null for unknown/empty targets. */
export function expandCuratedLink(kind: string, target: string): string | null {
  if (!target) return null;
  switch (kind) {
    case "wikipedia":
      // Wikipedia article title: spaces → underscores (MediaWiki convention).
      return `https://en.wikipedia.org/wiki/${wikiTitlePath(target)}`;
    case "search":
      return `https://www.ecosia.org/search?q=${encodeURIComponent(target)}`;
    default:
      return null;
  }
}

/** MediaWiki title path segment (spaces to _, then encode). */
function wikiTitlePath(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

/** Undo escapeHtml so URL query strings keep raw `&` before parsing. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
