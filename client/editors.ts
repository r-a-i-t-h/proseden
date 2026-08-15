/**
 * Preference-gated progressive enhancement for prose/JSON textareas.
 * Default is plain — upgrades only when the user opts in.
 * Structured JSON table editors (data-json-kind) appear with the enhanced JSON tools.
 */

import { formatJsonTextarea, prepareJsonTextarea } from "../src/json-textarea.js";
import { getJsonTableSchema } from "../src/json-table.js";

export type EditorPref = "plain" | "enhanced";

const PROSE_KEY = "proseden-editor-prose";
const JSON_KEY = "proseden-editor-json";

export function readEditorPref(kind: "prose" | "json"): EditorPref {
  try {
    const key = kind === "prose" ? PROSE_KEY : JSON_KEY;
    return localStorage.getItem(key) === "enhanced" ? "enhanced" : "plain";
  } catch {
    return "plain";
  }
}

export function writeEditorPref(kind: "prose" | "json", value: EditorPref): void {
  try {
    const key = kind === "prose" ? PROSE_KEY : JSON_KEY;
    if (value === "plain") localStorage.removeItem(key);
    else localStorage.setItem(key, "enhanced");
  } catch {
    /* ignore */
  }
}

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

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || "text";
  textarea.setRangeText(`${before}${selected}${after}`, start, end, "select");
  textarea.focus();
  const innerStart = start + before.length;
  textarea.setSelectionRange(innerStart, innerStart + selected.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

let editorFieldSeq = 0;

function ensureControlId(control: HTMLElement): string {
  if (control.id) return control.id;
  editorFieldSeq += 1;
  control.id = `editor-field-${editorFieldSeq}`;
  return control.id;
}

/**
 * Place chrome before a textarea. If the control sits inside a wrapping
 * `<label>`, lift the caption onto `label[for]` so toolbar buttons are not
 * labelable descendants (browsers propagate :hover to the first one).
 */
function insertBeforeTextarea(textarea: HTMLTextAreaElement, node: HTMLElement): void {
  const parent = textarea.parentElement;
  if (parent?.tagName === "LABEL") {
    const id = ensureControlId(textarea);
    const wrap = el("div", {
      class: parent.className ? `${parent.className} labeled-field` : "labeled-field",
    });
    const caption = el("label", { for: id });
    const preamble: ChildNode[] = [];
    for (let n = parent.firstChild; n && n !== textarea; n = n.nextSibling) {
      preamble.push(n);
    }
    for (const n of preamble) caption.append(n);
    parent.replaceWith(wrap);
    wrap.append(caption, node, textarea);
    return;
  }
  textarea.insertAdjacentElement("beforebegin", node);
}

function enhanceProse(textarea: HTMLTextAreaElement): void {
  if (textarea.dataset.enhanced === "prose") return;
  textarea.dataset.enhanced = "prose";
  const toolbar = el("div", { class: "editor-toolbar", role: "toolbar", "aria-label": "Prose adornments" });
  const buttons: Array<[string, string, () => void]> = [
    ["em", "_…_", () => wrapSelection(textarea, "_", "_")],
    ["bold", "*…*", () => wrapSelection(textarea, "*", "*")],
    ["strike", "~…~", () => wrapSelection(textarea, "~", "~")],
    ["code", "`…`", () => wrapSelection(textarea, "`", "`")],
    ["link", "[ ]( )", () => wrapSelection(textarea, "[", "](https://)")],
  ];
  for (const [label, title, action] of buttons) {
    const btn = el("button", { type: "button", class: "editor-tool", title, tabindex: "-1" }, label);
    // Keep the textarea selection when clicking the toolbar.
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      action();
    });
    toolbar.append(btn);
  }
  insertBeforeTextarea(textarea, toolbar);
}

type JsonTextarea = HTMLTextAreaElement & { __jsonFormatBlur?: () => void };

function stripJsonChrome(textarea: JsonTextarea): void {
  if (textarea.__jsonFormatBlur) {
    textarea.removeEventListener("blur", textarea.__jsonFormatBlur);
    delete textarea.__jsonFormatBlur;
  }
  const prev = textarea.previousElementSibling;
  if (prev?.classList.contains("editor-toolbar")) prev.remove();
  const next = textarea.nextElementSibling;
  if (next?.classList.contains("editor-json-status")) next.remove();
  delete textarea.dataset.enhanced;
}

function stripEnhancement(textarea: HTMLTextAreaElement): void {
  if (textarea.dataset.editor === "json") {
    stripJsonChrome(textarea);
    return;
  }
  const prev = textarea.previousElementSibling;
  if (prev?.classList.contains("editor-toolbar")) prev.remove();
  const next = textarea.nextElementSibling;
  if (next?.classList.contains("editor-json-status")) next.remove();
  delete textarea.dataset.enhanced;
}

/**
 * JSON tools (format + structured editor) only when the enhanced JSON
 * preference is on. Editor requires a registered data-json-kind schema.
 */
function syncJsonToolbar(textarea: JsonTextarea, formatOn: boolean): void {
  const schema = getJsonTableSchema(textarea.dataset.jsonKind);
  const wantsEditor = formatOn && Boolean(schema);
  if (!formatOn) {
    stripJsonChrome(textarea);
    return;
  }

  const desired = `${wantsEditor ? "editor" : ""}|format`;
  if (textarea.dataset.enhanced === `json:${desired}`) return;

  stripJsonChrome(textarea);

  const status = el("p", { class: "editor-json-status muted", hidden: true });
  const bar = el("div", { class: "editor-toolbar", role: "toolbar", "aria-label": "JSON tools" });

  if (wantsEditor) {
    const editorBtn = el(
      "button",
      { type: "button", class: "editor-tool", title: "Edit as table", tabindex: "-1" },
      "editor",
    );
    editorBtn.addEventListener("mousedown", (ev) => ev.preventDefault());
    editorBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      void import("./json-table-editor.js").then(({ openJsonTableEditor }) => {
        openJsonTableEditor(textarea, { status, returnFocus: editorBtn });
      });
    });
    bar.append(editorBtn);
  }

  const format = (): void => {
    try {
      const parsed = JSON.parse(prepareJsonTextarea(textarea.value));
      textarea.value = formatJsonTextarea(parsed);
      status.hidden = true;
      status.textContent = "";
      status.dataset.kind = "";
    } catch (err) {
      status.hidden = false;
      status.dataset.kind = "err";
      status.textContent = err instanceof Error ? err.message : "Invalid JSON";
    }
  };
  textarea.__jsonFormatBlur = format;
  textarea.addEventListener("blur", format);
  const formatBtn = el(
    "button",
    { type: "button", class: "editor-tool", title: "Format JSON", tabindex: "-1" },
    "format",
  );
  formatBtn.addEventListener("mousedown", (ev) => ev.preventDefault());
  formatBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    format();
  });
  bar.append(formatBtn);

  insertBeforeTextarea(textarea, bar);
  textarea.insertAdjacentElement("afterend", status);
  textarea.dataset.enhanced = `json:${desired}`;
}

/** Upgrade or restore textareas marked with data-editor according to preferences. */
export function applyEditorPreferences(root: ParentNode = document): void {
  const prosePref = readEditorPref("prose");
  const jsonPref = readEditorPref("json");
  for (const node of Array.from(root.querySelectorAll<HTMLTextAreaElement>("textarea[data-editor]"))) {
    const kind = node.dataset.editor;
    if (kind === "prose") {
      if (prosePref === "enhanced") enhanceProse(node);
      else stripEnhancement(node);
    } else if (kind === "json") {
      syncJsonToolbar(node, jsonPref === "enhanced");
    }
  }
}

/** Preference toggles for Edit panel / profile pages. */
export function editorPrefsControls(): HTMLElement {
  const wrap = el("div", { class: "editor-prefs" });
  wrap.append(el("p", { class: "muted" }, "Editors (optional):"));
  for (const kind of ["prose", "json"] as const) {
    const label = el(
      "label",
      { class: "edit-check" },
      el("input", {
        type: "checkbox",
        checked: readEditorPref(kind) === "enhanced",
      }),
      ` Enhanced ${kind} editor`,
    );
    const input = label.querySelector("input")!;
    input.addEventListener("change", () => {
      writeEditorPref(kind, input.checked ? "enhanced" : "plain");
      applyEditorPreferences(document);
    });
    wrap.append(label);
  }
  return wrap;
}
