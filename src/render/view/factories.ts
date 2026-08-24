import type {
  Control,
  LinkListItem,
  MetaPart,
  Node,
  PageView,
  StatListItem,
} from "./types.js";

export function fragment(...children: Node[]): Node {
  return { type: "fragment", children };
}

export function htmlOnly(...children: Node[]): Node {
  return { type: "fragment", channel: "html", children };
}

export function textOnly(...children: Node[]): Node {
  return { type: "fragment", channel: "text", children };
}

export function heading(
  level: 1 | 2 | 3,
  text: string,
  opts?: { sub?: string; detailSub?: string; class?: string },
): Node {
  return {
    type: "heading",
    level,
    text,
    sub: opts?.sub,
    detailSub: opts?.detailSub,
    class: opts?.class,
  };
}

export function entityTitle(
  kind: "scene" | "artefact",
  id: number,
  title?: string,
  detail?: string,
): Node {
  return { type: "entityTitle", kind, id, title, detail };
}

export function crumb(href: string, label: string, history?: boolean): Node {
  return { type: "crumb", href, label, history };
}

export function byline(username: string): Node {
  return { type: "byline", username };
}

export function userLink(username: string): Node {
  return { type: "userLink", username };
}

export function prose(text: string): Node {
  return { type: "prose", text };
}

export function muted(...parts: MetaPart[]): Node {
  return { type: "muted", parts };
}

export function notice(
  text: string,
  kind: "status" | "error" | "flash" = "status",
): Node {
  return { type: "notice", text, kind };
}

export function para(text: string, className?: string): Node {
  return { type: "para", text, class: className };
}

export function meta(...parts: MetaPart[]): Node {
  return { type: "meta", parts };
}

export function linkList(items: LinkListItem[]): Node {
  return { type: "linkList", items };
}

export function statList(items: StatListItem[]): Node {
  return { type: "statList", items };
}

export function section(title: string, children: Node[], channel?: "html" | "text" | "both"): Node {
  return { type: "section", title, children, channel };
}

export function detailsSection(
  summary: string,
  children: Node[],
  opts?: { open?: boolean; class?: string; attrs?: Record<string, string> },
): Node {
  return {
    type: "details",
    summary,
    open: opts?.open,
    class: opts?.class,
    attrs: opts?.attrs,
    children,
  };
}

export function form(
  opts: {
    action: string;
    method?: string;
    class?: string;
    id?: string;
    enctype?: string;
    textRecipes?: string[];
  },
  ...children: Node[]
): Node {
  return {
    type: "form",
    method: opts.method,
    action: opts.action,
    class: opts.class,
    id: opts.id,
    enctype: opts.enctype,
    textRecipes: opts.textRecipes,
    children,
  };
}

export function field(label: string, control: Control, className?: string): Node {
  return { type: "field", label, control, class: className };
}

export function jsonField(
  label: string,
  name: string,
  value: unknown,
  example: string,
  note: string,
  rows = 10,
  text?: string,
): Node {
  return { type: "jsonField", label, name, rows, value, example, note, text };
}

export function table(
  headers: string[],
  rows: Array<{ cells: Node[]; class?: string }>,
  opts?: { class?: string; empty?: string },
): Node {
  return {
    type: "table",
    headers,
    rows,
    class: opts?.class,
    empty: opts?.empty,
  };
}

export function button(label: string, opts?: { class?: string; buttonType?: "submit" | "button" }): Node {
  return {
    type: "button",
    label,
    class: opts?.class,
    buttonType: opts?.buttonType ?? "submit",
  };
}

export function pre(text: string, className?: string): Node {
  return { type: "pre", text, class: className };
}

export function rawText(lines: string[], channel?: "html" | "text" | "both"): Node {
  return { type: "rawText", lines, channel };
}

export function script(source: string): Node {
  return { type: "script", source };
}

export function unsafeHtml(html: string): Node {
  return { type: "unsafeHtml", html };
}

export function article(...children: Node[]): Node {
  return { type: "article", class: "inbox-item", children };
}

export function box(className: string, ...children: Node[]): Node {
  return { type: "box", class: className, children };
}

export function inboxHeader(createdAt: string, fromUser: string): Node {
  return { type: "inboxHeader", createdAt, fromUser };
}

export function pageView(title: string, body: Node[]): PageView {
  return { title, body };
}

/** Flatten nodes, skipping empties from optional crumbs etc. */
export function nodes(...items: Array<Node | Node[] | undefined | false | null>): Node[] {
  const out: Node[] = [];
  for (const item of items) {
    if (!item) continue;
    if (Array.isArray(item)) out.push(...item);
    else out.push(item);
  }
  return out;
}
