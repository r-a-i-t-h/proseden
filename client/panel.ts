import { mountEdit, readBootstrap, OLD_MODE_KEY, type EditBootstrap } from "./edit.js";
import { mountLive, type LiveController } from "./live.js";

const PANEL_KEY = "proseden-panel";
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
  const stored = localStorage.getItem(PANEL_KEY);
  if (stored === "live" || stored === "edit") {
    if (stored === "edit" && !boot.user) return "view";
    if (stored === "live" && boot.liveSceneId === undefined) return "view";
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

function writeMode(mode: PanelMode): void {
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

  const canLive = boot.liveSceneId !== undefined && (boot.user || boot.allowGuestLive);
  const canEdit = !!boot.user;

  const tabs = el("div", { class: "panel-tabs", role: "tablist", "aria-label": "Side panel" });
  const liveTab = el("button", { type: "button", class: "panel-tab", "data-mode": "live" }, "Live");
  const editTab = el("button", { type: "button", class: "panel-tab", "data-mode": "edit" }, "Edit");
  if (canLive) tabs.append(liveTab);
  if (canEdit) tabs.append(editTab);

  const livePane = el("div", { class: "panel-pane", id: "live-pane", hidden: true });
  const editPane = el("div", { class: "panel-pane", id: "edit-pane", hidden: true });
  root.replaceChildren(tabs, livePane, editPane);

  let live: LiveController | null = null;
  let editMounted = false;
  let editToolbar: HTMLElement | null = null;
  let mode: PanelMode = "view";

  const headerLive = document.getElementById("panel-live");
  const headerView = document.getElementById("panel-view");
  const headerEdit = document.getElementById("edit-enter");

  function ensureLive(): void {
    if (!canLive || live) return;
    live = mountLive(boot, livePane);
  }

  function ensureEdit(): void {
    if (!canEdit || editMounted) return;
    const result = mountEdit(boot, editPane);
    editToolbar = result.toolbar;
    editToolbar.hidden = true;
    editMounted = true;
  }

  function applyMode(next: PanelMode, persist = true): void {
    if (next === "edit" && !canEdit) next = canLive ? "live" : "view";
    if (next === "live" && !canLive) next = "view";
    mode = next;
    if (persist) writeMode(next);

    const open = next === "live" || next === "edit";
    root.hidden = !open;
    document.querySelector(".layout")?.classList.toggle("with-manage", open);
    document.body.classList.toggle("is-editing", next === "edit");
    document.body.classList.toggle("is-live", next === "live" || next === "edit");

    if (next === "live" || next === "edit") {
      ensureLive();
      live?.connect();
    } else {
      live?.disconnect();
    }

    if (next === "edit") ensureEdit();

    livePane.hidden = next !== "live";
    editPane.hidden = next !== "edit";
    if (editToolbar) editToolbar.hidden = next !== "edit";

    liveTab.classList.toggle("is-active", next === "live");
    editTab.classList.toggle("is-active", next === "edit");

    if (headerLive instanceof HTMLElement) {
      headerLive.hidden = !canLive || next === "live";
    }
    if (headerView instanceof HTMLElement) {
      headerView.hidden = next === "view";
    }
    if (headerEdit instanceof HTMLAnchorElement) {
      headerEdit.hidden = next === "edit";
      headerEdit.textContent = "Edit";
    }
  }

  liveTab.addEventListener("click", () => applyMode("live"));
  editTab.addEventListener("click", () => applyMode("edit"));
  headerLive?.addEventListener("click", () => applyMode("live"));
  headerView?.addEventListener("click", () => applyMode("view"));
  if (headerEdit instanceof HTMLAnchorElement) {
    headerEdit.addEventListener("click", (event) => {
      if (!canEdit) return;
      event.preventDefault();
      applyMode("edit");
      const url = new URL(window.location.href);
      if (!url.searchParams.has("edit")) {
        url.searchParams.set("edit", "");
        history.replaceState(null, "", url.pathname + url.search.replace(/=(?=&|$)/g, "") + url.hash);
      }
    });
  }

  applyMode(readMode(boot), false);
}

bootPanel();
