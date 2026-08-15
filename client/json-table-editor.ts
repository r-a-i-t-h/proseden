/**
 * Dialog UI for schema-driven JSON table editing.
 * Pure parse/serialize lives in src/json-table.ts for reuse and tests.
 */

import { formatJsonTextarea, prepareJsonTextarea } from "../src/json-textarea.js";
import {
  ALL_RIGHTS,
  getJsonTableSchema,
  type JsonTableColumn,
  type JsonTableRow,
  type JsonTableSchema,
} from "../src/json-table.js";
import { applyEditorPreferences } from "./editors.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function emptyRow(schema: JsonTableSchema): JsonTableRow {
  const row: JsonTableRow = {};
  for (const col of schema.columns) {
    if (col.type === "rights") row[col.key] = [];
    else row[col.key] = "";
  }
  return row;
}

function readCell(tr: HTMLTableRowElement, col: JsonTableColumn): unknown {
  if (col.type === "rights") {
    const checked = tr.querySelectorAll<HTMLInputElement>(`input[data-col="${col.key}"]:checked`);
    return Array.from(checked).map((input) => input.value);
  }
  const control = tr.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-col="${col.key}"]`);
  return control?.value ?? "";
}

function readRows(tbody: HTMLTableSectionElement, schema: JsonTableSchema): JsonTableRow[] {
  const rows: JsonTableRow[] = [];
  for (const tr of Array.from(tbody.querySelectorAll("tr"))) {
    const row: JsonTableRow = {};
    for (const col of schema.columns) {
      row[col.key] = readCell(tr, col);
    }
    rows.push(row);
  }
  return rows;
}

function renderCell(col: JsonTableColumn, value: unknown): HTMLElement {
  if (col.type === "prose") {
    return el(
      "textarea",
      {
        class: "json-table-prose",
        "data-col": col.key,
        "data-editor": "prose",
        rows: String(col.rows ?? 4),
      },
      String(value ?? ""),
    );
  }
  if (col.type === "rights") {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    const wrap = el("div", {
      class: "json-table-rights",
      title: col.allowEmpty ? "Leave all unchecked to deny every right" : undefined,
    });
    for (const right of ALL_RIGHTS) {
      wrap.append(
        el(
          "label",
          { class: "json-table-right" },
          el("input", {
            type: "checkbox",
            value: right,
            "data-col": col.key,
            checked: selected.has(right),
          }),
          right,
        ),
      );
    }
    return wrap;
  }
  return el("input", {
    type: "text",
    class: "json-table-text",
    "data-col": col.key,
    value: String(value ?? ""),
    placeholder: col.placeholder,
  });
}

function renderRow(schema: JsonTableSchema, row: JsonTableRow, tbody: HTMLTableSectionElement): HTMLTableRowElement {
  const tr = el("tr");
  for (const col of schema.columns) {
    tr.append(el("td", { "data-label": col.label }, renderCell(col, row[col.key])));
  }
  const actions = el("td", { class: "json-table-actions" });
  const up = el("button", { type: "button", class: "editor-tool", title: "Move up" }, "↑");
  const down = el("button", { type: "button", class: "editor-tool", title: "Move down" }, "↓");
  const del = el("button", { type: "button", class: "editor-tool", title: "Delete row" }, "×");
  up.addEventListener("click", (ev) => {
    ev.preventDefault();
    const prev = tr.previousElementSibling;
    if (prev) tbody.insertBefore(tr, prev);
  });
  down.addEventListener("click", (ev) => {
    ev.preventDefault();
    const next = tr.nextElementSibling;
    if (next) tbody.insertBefore(next, tr);
  });
  del.addEventListener("click", (ev) => {
    ev.preventDefault();
    tr.remove();
  });
  actions.append(up, down, del);
  tr.append(actions);
  return tr;
}

function setDialogError(node: HTMLElement, message: string | null): void {
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

/**
 * Open the structured table editor for a tagged JSON textarea.
 * On Apply, writes pretty JSON back via formatJsonTextarea.
 */
export function openJsonTableEditor(
  textarea: HTMLTextAreaElement,
  opts: { status?: HTMLElement | null; returnFocus?: HTMLElement | null } = {},
): void {
  const schema = getJsonTableSchema(textarea.dataset.jsonKind);
  if (!schema) return;

  const showErr = (message: string) => {
    const status = opts.status;
    if (status) {
      status.hidden = false;
      status.dataset.kind = "err";
      status.textContent = message;
    }
  };

  let parsed: unknown;
  try {
    const trimmed = textarea.value.trim();
    parsed = trimmed === "" ? schema.emptyValue : JSON.parse(prepareJsonTextarea(textarea.value));
  } catch (err) {
    showErr(err instanceof Error ? err.message : "Invalid JSON");
    return;
  }

  const loaded = schema.toRows(parsed);
  if (!loaded.ok) {
    showErr(loaded.error);
    return;
  }

  if (opts.status) {
    opts.status.hidden = true;
    opts.status.textContent = "";
    opts.status.dataset.kind = "";
  }

  const dialog = el("dialog", { class: "json-table-dialog" });
  const form = el("form", { class: "json-table-form" });
  form.addEventListener("submit", (ev) => ev.preventDefault());
  const heading = el("h2", { class: "json-table-title" }, `Edit ${schema.title}`);
  const err = el("p", { class: "json-table-error muted", hidden: true });
  const scroll = el("div", { class: "json-table-scroll" });
  const table = el("table", { class: "json-table" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const col of schema.columns) {
    headRow.append(el("th", {}, col.label));
  }
  headRow.append(el("th", { class: "json-table-actions-head" }, " "));
  thead.append(headRow);
  const tbody = el("tbody");
  for (const row of loaded.rows) {
    tbody.append(renderRow(schema, row, tbody));
  }
  table.append(thead, tbody);
  scroll.append(table);

  const footer = el("div", { class: "json-table-footer" });
  const addBtn = el("button", { type: "button", class: "editor-tool" }, "Add row");
  const cancelBtn = el("button", { type: "button", class: "editor-tool" }, "Cancel");
  const applyBtn = el("button", { type: "button", class: "editor-tool json-table-apply" }, "Apply");
  addBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    tbody.append(renderRow(schema, emptyRow(schema), tbody));
    applyEditorPreferences(dialog);
    const last = tbody.lastElementChild?.querySelector<HTMLElement>("input, textarea");
    last?.focus();
  });
  cancelBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    dialog.close("cancel");
  });
  applyBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const result = schema.fromRows(readRows(tbody, schema));
    if (!result.ok) {
      setDialogError(err, result.error);
      return;
    }
    textarea.value = formatJsonTextarea(result.value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    dialog.close("apply");
  });

  footer.append(addBtn, el("span", { class: "json-table-footer-spacer" }), cancelBtn, applyBtn);
  form.append(heading, err, scroll, footer);
  dialog.append(form);
  document.body.append(dialog);
  applyEditorPreferences(dialog);

  const cleanup = () => {
    dialog.removeEventListener("close", cleanup);
    dialog.remove();
    opts.returnFocus?.focus();
  };
  dialog.addEventListener("close", cleanup);
  dialog.showModal();

  const first = tbody.querySelector<HTMLElement>("input, textarea");
  (first ?? addBtn).focus();
}
