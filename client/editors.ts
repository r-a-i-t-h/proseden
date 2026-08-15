/**
 * Preference-gated progressive enhancement for prose/JSON textareas.
 * Default is plain — upgrades only when the user opts in.
 */

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
    const btn = el("button", { type: "button", class: "editor-tool", title }, label);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      action();
    });
    toolbar.append(btn);
  }
  textarea.insertAdjacentElement("beforebegin", toolbar);
}

function enhanceJson(textarea: HTMLTextAreaElement): void {
  if (textarea.dataset.enhanced === "json") return;
  textarea.dataset.enhanced = "json";
  const status = el("p", { class: "editor-json-status muted", hidden: true });
  const format = (): void => {
    try {
      const parsed = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(parsed, null, 2);
      status.hidden = true;
      status.textContent = "";
      status.dataset.kind = "";
    } catch (err) {
      status.hidden = false;
      status.dataset.kind = "err";
      status.textContent = err instanceof Error ? err.message : "Invalid JSON";
    }
  };
  textarea.addEventListener("blur", format);
  const bar = el("div", { class: "editor-toolbar", role: "toolbar", "aria-label": "JSON tools" });
  const btn = el("button", { type: "button", class: "editor-tool", title: "Format JSON" }, "format");
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    format();
  });
  bar.append(btn);
  textarea.insertAdjacentElement("beforebegin", bar);
  textarea.insertAdjacentElement("afterend", status);
}

function stripEnhancement(textarea: HTMLTextAreaElement): void {
  const prev = textarea.previousElementSibling;
  if (prev?.classList.contains("editor-toolbar")) prev.remove();
  const next = textarea.nextElementSibling;
  if (next?.classList.contains("editor-json-status")) next.remove();
  delete textarea.dataset.enhanced;
}

/** Upgrade or restore textareas marked with data-editor according to preferences. */
export function applyEditorPreferences(root: ParentNode = document): void {
  const prosePref = readEditorPref("prose");
  const jsonPref = readEditorPref("json");
  for (const node of root.querySelectorAll<HTMLTextAreaElement>("textarea[data-editor]")) {
    const kind = node.dataset.editor;
    if (kind === "prose") {
      if (prosePref === "enhanced") enhanceProse(node);
      else stripEnhancement(node);
    } else if (kind === "json") {
      if (jsonPref === "enhanced") enhanceJson(node);
      else stripEnhancement(node);
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
