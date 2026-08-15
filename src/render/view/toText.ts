import { entityKindLabel, userPath } from "../entity.js";
import { relativeAge } from "../relative-age.js";
import type { Node, TextRenderOptions } from "./types.js";

function channelOk(channel: "html" | "text" | "both" | undefined): boolean {
  return channel === undefined || channel === "both" || channel === "text";
}

/** Match historical `${basePath}/path` (empty base → `/path`). */
function withBase(base: string, href: string): string {
  const path = href.replace(/^\.\//, "");
  return `${base}/${path}`;
}

function expandBase(template: string, base: string): string {
  return template.replaceAll("{base}", base);
}

function pushNodes(lines: string[], nodes: Node[], opts: TextRenderOptions): void {
  for (const node of nodes) {
    pushNode(lines, node, opts);
  }
}

function pushNode(lines: string[], node: Node, opts: TextRenderOptions): void {
  const base = opts.basePath ?? "";
  switch (node.type) {
    case "fragment":
      if (!channelOk(node.channel)) return;
      pushNodes(lines, node.children, opts);
      return;
    case "heading": {
      if (node.level === 1) {
        if (node.detailSub) {
          lines.push(`[${node.text} — detail:${node.detailSub}]`);
        } else if (node.sub) {
          lines.push(`[${node.text} ${node.sub}]`);
        } else {
          lines.push(`[${node.text}]`);
        }
      } else {
        lines.push(`${node.text}:`);
      }
      return;
    }
    case "entityTitle": {
      const kindCap = entityKindLabel(node.kind);
      const name = node.title ? `: ${node.title}` : "";
      if (node.detail) {
        lines.push(`[${kindCap} ${node.id}${name} — detail:${node.detail}]`);
      } else {
        lines.push(`[${kindCap} ${node.id}${name}]`);
      }
      return;
    }
    case "crumb":
      lines.push(`${node.label}  ${withBase(base, node.href)}`);
      return;
    case "byline":
      if (node.username) {
        lines.push(`by ${node.username}  ${withBase(base, userPath(node.username))}`);
      }
      return;
    case "prose":
    case "para":
      lines.push(expandBase(node.text, base));
      return;
    case "muted":
      lines.push(`(${node.text})`);
      return;
    case "notice":
      lines.push(node.text);
      lines.push("");
      return;
    case "meta": {
      if (!node.parts.length) return;
      const parts = node.parts.map((p) => {
        if (typeof p === "string") return p;
        if (p.type === "relativeAge") return `last seen ${relativeAge(p.iso)}`;
        return p.username;
      });
      lines.push(parts.join(" · "));
      return;
    }
    case "linkList":
      for (const item of node.items) {
        const href = withBase(base, item.textHref ?? item.href);
        const note = item.note ? ` (${item.note})` : "";
        if (item.textId !== undefined) {
          lines.push(`  ${item.textId}. ${item.label}${note}  ${href}`);
        } else {
          lines.push(`  - ${item.label}${note}  ${href}`);
        }
      }
      return;
    case "section":
      if (!channelOk(node.channel)) return;
      lines.push(`${node.title}:`);
      pushNodes(lines, node.children, opts);
      lines.push("");
      return;
    case "details":
      lines.push(`${node.summary}:`);
      pushNodes(lines, node.children, opts);
      lines.push("");
      return;
    case "userLink":
      lines.push(`${node.username}  ${withBase(base, userPath(node.username))}`);
      return;
    case "form":
      if (node.textRecipes?.length) {
        for (const recipe of node.textRecipes) {
          lines.push(`  ${expandBase(recipe, base)}`);
        }
      }
      return;
    case "actionRecipes":
      lines.push("Actions:");
      for (const recipe of node.recipes) {
        lines.push(`  ${expandBase(recipe, base)}`);
      }
      lines.push("");
      return;
    case "field":
    case "jsonField":
    case "button":
    case "script":
    case "unsafeHtml":
      return;
    case "pre":
      lines.push(node.text);
      return;
    case "rawText":
      if (!channelOk(node.channel)) return;
      for (const line of node.lines) {
        lines.push(expandBase(line, base));
      }
      return;
    case "article":
      pushNodes(lines, node.children, opts);
      lines.push("");
      return;
    case "box":
      pushNodes(lines, node.children, opts);
      return;
    case "inboxHeader":
      lines.push(`— ${node.createdAt} from ${node.fromUser}`);
      return;
    default:
      return;
  }
}

/** Serialize document nodes to a curl-friendly plain-text body. */
export function toText(body: Node[], opts: TextRenderOptions = {}): string {
  const lines: string[] = [];
  pushNodes(lines, body, opts);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderPageText(view: { body: Node[] }, opts: TextRenderOptions = {}): string {
  return toText(view.body, opts);
}
