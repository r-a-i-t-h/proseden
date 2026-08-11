/**
 * Lightweight prose adornments for scene/artefact bodies (Markdown-adjacent, not full MD).
 *
 * Inline: `_em_`, `*strong*`, `~strike~`, `` `code` ``
 * Block:  `# subtitle` → h3, `## minor` → h4 (page title stays h1)
 */

export function formatProse(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const html = formatInline(escapeHtml(para.join("\n"))).replace(/\n/g, "<br />");
    out.push(`<p>${html}</p>`);
    para = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,2})\s+(.+?)\s*$/);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      const tag = level === 1 ? "h3" : "h4";
      const cls = level === 1 ? "desc-heading" : "desc-heading-minor";
      out.push(
        `<${tag} class="${cls}">${formatInline(escapeHtml(heading[2]!))}</${tag}>`,
      );
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out.join("");
}

/** Apply inline adornments to already-escaped HTML text. */
export function formatInline(escaped: string): string {
  // Order: code first (so markers inside code stay literal), then strong/em/strike.
  let s = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  // Word-boundary-ish underscores so snake_case is left alone.
  s = s.replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "<em>$1</em>");
  s = s.replace(/~([^~\n]+)~/g, "<s>$1</s>");
  return s;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
