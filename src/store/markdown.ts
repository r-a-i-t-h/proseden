import matter from "gray-matter";

const DETAIL_HEADING = /^##\s+detail:([A-Za-z0-9_-]+)\s*$/;

export function parseProseDocument<T extends object>(
  raw: string,
): { meta: T; body: string; details: Record<string, string> } {
  const parsed = matter(raw);
  const { body, details } = splitDetails(parsed.content.trim());
  return {
    meta: parsed.data as T,
    body,
    details,
  };
}

export function serializeProseDocument(
  meta: object,
  body: string,
  details: Record<string, string>,
): string {
  const detailBlocks = Object.entries(details)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, text]) => `## detail:${slug}\n${text.trim()}`)
    .join("\n\n");

  const content = [body.trim(), detailBlocks].filter(Boolean).join("\n\n");
  const cleanMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (value !== undefined) cleanMeta[key] = value;
  }
  return matter.stringify(`${content}\n`, cleanMeta);
}

function splitDetails(content: string): { body: string; details: Record<string, string> } {
  const lines = content.split(/\r?\n/);
  const bodyLines: string[] = [];
  const details: Record<string, string> = {};
  let currentDetail: string | null = null;
  let detailLines: string[] = [];

  const flushDetail = () => {
    if (currentDetail) {
      details[currentDetail] = detailLines.join("\n").trim();
      currentDetail = null;
      detailLines = [];
    }
  };

  for (const line of lines) {
    const match = line.match(DETAIL_HEADING);
    if (match) {
      flushDetail();
      currentDetail = match[1]!;
      continue;
    }
    if (currentDetail) {
      detailLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }
  flushDetail();

  return {
    body: bodyLines.join("\n").trim(),
    details,
  };
}
