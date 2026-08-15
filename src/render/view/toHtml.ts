import { escapeAttr } from "../escape.js";
import { entityDisplayTitle, userPath } from "../entity.js";
import { escapeHtml, formatProse } from "../prose.js";
import { relativeAgeHtml } from "../relative-age.js";
import { dataJsonKindAttr } from "../../json-table.js";
import { formatJsonTextarea } from "../../json-textarea.js";
import type { Control, MetaPart, Node } from "./types.js";

function channelOk(channel: "html" | "text" | "both" | undefined): boolean {
  return channel === undefined || channel === "both" || channel === "html";
}

function renderNodes(nodes: Node[]): string {
  return nodes.map(renderNode).filter(Boolean).join("\n");
}

function renderMetaPart(part: MetaPart): string {
  if (typeof part === "string") return escapeHtml(part);
  if (part.type === "relativeAge") return relativeAgeHtml(part.iso);
  return userLink(part.username);
}

export function userLink(username: string): string {
  return `<a href="${userPath(username)}">${escapeHtml(username)}</a>`;
}

let fieldIdSeq = 0;

function nextFieldId(name: string): string {
  fieldIdSeq += 1;
  return `f-${name}-${fieldIdSeq}`;
}

function renderControl(control: Control, id?: string): string {
  const idAttr = id ? ` id="${escapeAttr(id)}"` : "";
  switch (control.type) {
    case "text":
    case "number":
    case "password": {
      const value =
        control.type !== "password" && "value" in control && control.value !== undefined
          ? `value="${escapeAttr(control.value)}"`
          : "";
      const attrs = [
        `name="${escapeAttr(control.name)}"`,
        `type="${control.type}"`,
        idAttr,
        value,
        control.required ? "required" : "",
        "min" in control && control.min !== undefined ? `min="${escapeAttr(control.min)}"` : "",
        "minlength" in control && control.minlength !== undefined
          ? `minlength="${control.minlength}"`
          : "",
        "autocomplete" in control && control.autocomplete
          ? `autocomplete="${escapeAttr(control.autocomplete)}"`
          : "",
        "placeholder" in control && control.placeholder
          ? `placeholder="${escapeAttr(control.placeholder)}"`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<input ${attrs} />`;
    }
    case "checkbox": {
      const checked = control.checked ? " checked" : "";
      const cls = control.class ? ` class="${escapeAttr(control.class)}"` : "";
      return `<label${cls}><input type="checkbox" name="${escapeAttr(control.name)}" value="${escapeAttr(control.value ?? "1")}"${checked} /> ${escapeHtml(control.label)}</label>`;
    }
    case "hidden":
      return `<input type="hidden" name="${escapeAttr(control.name)}" value="${escapeAttr(control.value)}" />`;
    case "select": {
      const options = control.options
        .map((o) => {
          const sel = o.selected ? " selected" : "";
          const dis = o.disabled ? " disabled" : "";
          return `<option value="${escapeAttr(o.value)}"${sel}${dis}>${escapeHtml(o.label)}</option>`;
        })
        .join("");
      return `<select name="${escapeAttr(control.name)}"${idAttr}${control.required ? " required" : ""}>${options}</select>`;
    }
    case "textarea": {
      const value =
        control.editor === "json" && control.jsonValue !== undefined
          ? formatJsonTextarea(control.jsonValue)
          : control.value;
      const editor =
        control.editor && control.editor !== "plain"
          ? ` data-editor="${escapeAttr(control.editor)}"`
          : "";
      return `<textarea name="${escapeAttr(control.name)}"${idAttr} rows="${control.rows ?? 8}"${control.required ? " required" : ""}${editor}>${escapeHtml(value)}</textarea>`;
    }
    case "button": {
      const cls = control.class ? ` class="${escapeAttr(control.class)}"` : "";
      return `<button type="${control.buttonType ?? "submit"}"${cls}>${escapeHtml(control.label)}</button>`;
    }
  }
}

function renderJsonField(node: Extract<Node, { type: "jsonField" }>): string {
  return `<div class="json-field">
      <div class="json-field-label">
        <span>${escapeHtml(node.label)}</span>
        <details class="json-format-help">
          <summary class="json-format-info" title="Example ${escapeAttr(node.label)}">i</summary>
          <div class="json-format-example">
            <p class="muted">${escapeHtml(node.note)}</p>
            <pre>${escapeHtml(node.example)}</pre>
          </div>
        </details>
      </div>
      <textarea name="${escapeAttr(node.name)}" rows="${node.rows ?? 10}" data-editor="json"${dataJsonKindAttr(node.name)}>${escapeHtml(formatJsonTextarea(node.value))}</textarea>
    </div>`;
}

function renderNode(node: Node): string {
  switch (node.type) {
    case "fragment":
      if (!channelOk(node.channel)) return "";
      return renderNodes(node.children);
    case "heading": {
      const tag = `h${node.level}`;
      const cls = node.class ? ` class="${escapeAttr(node.class)}"` : "";
      const sub = node.sub
        ? ` <span class="sub">${escapeHtml(node.sub)}</span>`
        : node.detailSub
          ? ` <span class="detail-sub">detail: ${escapeHtml(node.detailSub)}</span>`
          : "";
      return `<${tag}${cls}>${escapeHtml(node.text)}${sub}</${tag}>`;
    }
    case "entityTitle": {
      const label = entityDisplayTitle(node.kind, node.id, node.title);
      if (node.detail) {
        return `<h1>${escapeHtml(label)} <span class="detail-sub">detail: ${escapeHtml(node.detail)}</span></h1>`;
      }
      return `<h1>${escapeHtml(label)} <span class="sub">#${node.id}</span></h1>`;
    }
    case "crumb":
      return `<p class="crumb"><a href="${escapeAttr(node.href)}"${node.history ? ' data-nav="back"' : ""}>${escapeHtml(node.label)}</a></p>`;
    case "byline":
      return node.username
        ? `<p class="byline">by ${userLink(node.username)}</p>`
        : "";
    case "prose":
      return `<div class="desc">${formatProse(node.text)}</div>`;
    case "muted":
      return `<p class="muted">${escapeHtml(node.text)}</p>`;
    case "notice": {
      if (node.kind === "error") {
        return `<p class="notice notice-error" role="alert">${escapeHtml(node.text)}</p>`;
      }
      if (node.kind === "flash") {
        return `<p class="flash">${escapeHtml(node.text)}</p>`;
      }
      return `<p class="notice" role="status">${escapeHtml(node.text)}</p>`;
    }
    case "para":
      return `<p${node.class ? ` class="${escapeAttr(node.class)}"` : ""}>${escapeHtml(node.text)}</p>`;
    case "meta": {
      if (!node.parts.length) return "";
      return `<p class="meta">${node.parts.map(renderMetaPart).join(" · ")}</p>`;
    }
    case "linkList": {
      if (!node.items.length) return "";
      const items = node.items
        .map((item) => {
          let trailing = "";
          if (item.noteHtml) {
            trailing = ` <span class="muted">${item.noteHtml}</span>`;
          } else if (item.note) {
            trailing = ` <span class="muted">(${escapeHtml(item.note)})</span>`;
          }
          return `<li><a href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>${trailing}</li>`;
        })
        .join("");
      return `<ul class="link-list">${items}</ul>`;
    }
    case "section":
      if (!channelOk(node.channel)) return "";
      return `<section><h2>${escapeHtml(node.title)}</h2>${renderNodes(node.children)}</section>`;
    case "details": {
      const cls = node.class ? ` class="${escapeAttr(node.class)}"` : "";
      const open = node.open ? " open" : "";
      return `<details${cls}${open}><summary>${escapeHtml(node.summary)}</summary>${renderNodes(node.children)}</details>`;
    }
    case "userLink":
      return userLink(node.username);
    case "form": {
      const method = node.method ?? "post";
      const cls = node.class ? ` class="${escapeAttr(node.class)}"` : "";
      const id = node.id ? ` id="${escapeAttr(node.id)}"` : "";
      return `<form method="${escapeAttr(method)}" action="${escapeAttr(node.action)}"${cls}${id}>${renderNodes(node.children)}</form>`;
    }
    case "field": {
      if (node.control.type === "textarea" && node.control.editor === "json") {
        return renderJsonField({
          type: "jsonField",
          label: node.label,
          name: node.control.name,
          rows: node.control.rows,
          value: node.control.jsonValue ?? {},
          example: node.control.jsonExample ?? "",
          note: node.control.jsonHelp ?? "",
        });
      }
      if (node.control.type === "checkbox") {
        return renderControl(node.control);
      }
      if (node.control.type === "hidden" || !node.label) {
        return renderControl(node.control);
      }
      // Div + label[for]: toolbars must not sit inside a wrapping <label>
      // (browsers propagate :hover to the first labelable control).
      const id = nextFieldId(node.control.name);
      const classes = ["labeled-field", node.class].filter(Boolean).join(" ");
      return `<div class="${escapeAttr(classes)}"><label for="${escapeAttr(id)}">${escapeHtml(node.label)}</label> ${renderControl(node.control, id)}</div>`;
    }
    case "jsonField":
      return renderJsonField(node);
    case "button": {
      const cls = node.class ? ` class="${escapeAttr(node.class)}"` : "";
      return `<button type="${node.buttonType ?? "submit"}"${cls}>${escapeHtml(node.label)}</button>`;
    }
    case "pre": {
      const cls = node.class ? ` class="${escapeAttr(node.class)}"` : "";
      return `<pre${cls}>${escapeHtml(node.text)}</pre>`;
    }
    case "rawText":
      return "";
    case "actionRecipes":
      return "";
    case "script":
      return `<script>\n${node.source}\n    </script>`;
    case "unsafeHtml":
      return node.html;
    case "article":
      return `<article${node.class ? ` class="${escapeAttr(node.class)}"` : ""}>${renderNodes(node.children)}</article>`;
    case "box":
      return `<div${node.class ? ` class="${escapeAttr(node.class)}"` : ""}>${renderNodes(node.children)}</div>`;
    case "inboxHeader":
      return `<header class="inbox-meta">
        <time datetime="${escapeAttr(node.createdAt)}">${escapeHtml(node.createdAt)}</time>
        <span>from <strong>${userLink(node.fromUser)}</strong></span>
      </header>`;
  }
}

/** Serialize document nodes to an HTML body fragment. */
export function toHtml(body: Node[]): string {
  return renderNodes(body);
}
