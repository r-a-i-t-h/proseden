import { mountEdit, readBootstrap, OLD_MODE_KEY, type EditBootstrap } from "./edit.js";
import { applyEditorPreferences, editorPrefsControls } from "./editors.js";
import { mountLive, type LiveController } from "./live.js";

const PANEL_KEY = "proseden-panel";
const GUEST_LIVE_KEY = "proseden-panel-guest-live";
type PanelMode = "live" | "edit" | "view";

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

function readMode(boot: EditBootstrap): PanelMode {
  const params = new URLSearchParams(window.location.search);
  if (params.has("edit") && boot.user) {
    localStorage.setItem(PANEL_KEY, "edit");
    return "edit";
  }
  if (!boot.user) {
    if (sessionStorage.getItem(GUEST_LIVE_KEY) === "1" && boot.liveSceneId !== undefined) {
      return "live";
    }
    return "view";
  }
  const stored = localStorage.getItem(PANEL_KEY);
  if (stored === "live" || stored === "edit") {
    if (stored === "live" && boot.liveSceneId === undefined) return "edit";
    return stored;
  }
  // Migrate old edit sticky flag.
  if (sessionStorage.getItem(OLD_MODE_KEY) === "1" && boot.user) {
    sessionStorage.removeItem(OLD_MODE_KEY);
    localStorage.setItem(PANEL_KEY, "edit");
    return "edit";
  }
  return "view";
}

function writeMode(mode: PanelMode, signedIn: boolean): void {
  if (!signedIn) {
    if (mode === "live") sessionStorage.setItem(GUEST_LIVE_KEY, "1");
    else sessionStorage.removeItem(GUEST_LIVE_KEY);
    return;
  }
  sessionStorage.removeItem(GUEST_LIVE_KEY);
  if (mode === "view") localStorage.removeItem(PANEL_KEY);
  else localStorage.setItem(PANEL_KEY, mode);
}

function bootPanel(): void {
  const bootMaybe = readBootstrap();
  if (!bootMaybe) return;
  const boot: EditBootstrap = bootMaybe;

  const rootEl = document.getElementById("edit-root");
  if (!rootEl) return;
  const root: HTMLElement = rootEl;

  const canLive = boot.liveSceneId !== undefined && !!(boot.user || boot.allowGuestLive);
  const canEdit = !!boot.user;

  const livePane = el("div", { class: "panel-pane", id: "live-pane", hidden: true });
  const editPane = el("div", { class: "panel-pane", id: "edit-pane", hidden: true });
  root.replaceChildren(livePane, editPane);

  let live: LiveController | null = null;
  let editMounted = false;
  let editToolbar: HTMLElement | null = null;
  let mode: PanelMode = "view";

  const headerLive = document.getElementById("panel-live");
  const headerEdit = document.getElementById("panel-edit");
  const headerView = document.getElementById("panel-view");

  function ensureLive(): void {
    if (!canLive || live) return;
    live = mountLive(boot, livePane);
  }

  function ensureEdit(): void {
    if (!canEdit || editMounted) return;
    const result = mountEdit(boot, editPane);
    editToolbar = result.toolbar;
    editToolbar.hidden = true;
    root.prepend(editToolbar);
    editMounted = true;
  }

  function setHeaderMode(next: PanelMode): void {
    const buttons: Array<{ el: HTMLElement | null; mode: PanelMode; allowed: boolean }> = [
      { el: headerLive, mode: "live", allowed: canLive },
      { el: headerEdit, mode: "edit", allowed: canEdit },
      { el: headerView, mode: "view", allowed: true },
    ];
    for (const { el, mode: m, allowed } of buttons) {
      if (!(el instanceof HTMLButtonElement)) continue;
      const current = next === m;
      el.disabled = !allowed || current;
      el.setAttribute("aria-pressed", current ? "true" : "false");
      el.classList.toggle("is-current", current);
    }
  }

  function applyMode(next: PanelMode, persist = true): void {
    if (next === "edit" && !canEdit) next = canLive ? "live" : "view";
    if (next === "live" && !canLive) next = "view";
    mode = next;
    if (persist) writeMode(next, !!boot.user);

    const open = next === "live" || next === "edit";
    root.hidden = !open;
    document.querySelector(".layout")?.classList.toggle("with-manage", open);
    document.body.classList.toggle("is-editing", next === "edit");
    document.body.classList.toggle("is-live", next === "live" || next === "edit");

    if (next === "live" || next === "edit") {
      ensureLive();
      if (canEdit) ensureEdit();
      live?.connect();
    } else {
      live?.disconnect();
    }

    livePane.hidden = next !== "live";
    editPane.hidden = next !== "edit";
    if (editToolbar) editToolbar.hidden = !(next === "live" || next === "edit");

    setHeaderMode(next);
  }

  headerLive?.addEventListener("click", () => {
    if (headerLive instanceof HTMLButtonElement && headerLive.disabled) return;
    applyMode("live");
  });
  headerView?.addEventListener("click", () => {
    if (headerView instanceof HTMLButtonElement && headerView.disabled) return;
    applyMode("view");
  });
  headerEdit?.addEventListener("click", () => {
    if (!(headerEdit instanceof HTMLButtonElement) || headerEdit.disabled) return;
    applyMode("edit");
    const url = new URL(window.location.href);
    if (!url.searchParams.has("edit")) {
      url.searchParams.set("edit", "");
      history.replaceState(null, "", url.pathname + url.search.replace(/=(?=&|$)/g, "") + url.hash);
    }
  });

  applyMode(readMode(boot), false);

  applyEditorPreferences(document);
  const main = document.querySelector("main.prose");
  if (
    main?.querySelector("textarea[data-editor]") &&
    !main.querySelector(".editor-prefs")
  ) {
    main.append(editorPrefsControls());
  }

  document.querySelector<HTMLAnchorElement>('a[data-nav="back"]')?.addEventListener("click", (e) => {
    if (window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  });
}

bootPanel();
