import { formatJsonTextarea } from "../src/json-textarea.js";
import {
  DENIES_EXAMPLE,
  DETAILS_EXAMPLE,
  GRANTS_EXAMPLE,
} from "../src/render/view/examples.js";
import { applyEditorPreferences, editorPrefsControls } from "./editors.js";

interface OwnedSceneLink {
  id: number;
  title?: string;
}

interface ManageContext {
  kind: "scene" | "artefact" | "inventory" | "home";
  scene?: {
    id: number;
    title?: string;
    body: string;
    details: Record<string, string>;
    visibility: string;
    isJunction?: boolean;
    owner?: string;
    groupId?: string | null;
    entranceGroupId?: string | null;
    grants?: unknown;
    denies?: unknown;
  };
  artefact?: {
    id: number;
    title?: string;
    body: string;
    details: Record<string, string>;
    homeSceneId: number;
    tags: string[];
  };
  exits?: Array<{ exitId: number; nickname: string; toSceneId: number; canRemove?: boolean }>;
  canEdit?: boolean;
  canManage?: boolean;
  canAddExit?: boolean;
  canOrganise?: boolean;
  canDelete?: boolean;
  canTransfer?: boolean;
  groups?: Array<{ id: string; title: string }>;
  entranceGroups?: Array<{ id: string; title: string; entranceSceneId: number }>;
  sceneGroup?: { id: string; title: string };
}

interface EditBootstrap {
  user?: { username: string };
  manage?: ManageContext;
  ownedScenes: OwnedSceneLink[];
  isManager: boolean;
  isModerator?: boolean;
  editHref: string;
  readHref: string;
  liveSceneId?: number;
  allowGuestLive?: boolean;
}

const FLASH_KEY = "proseden-edit-flash";
const OLD_MODE_KEY = "proseden-edit";

type ToolId =
  | "page"
  | "new"
  | "artefact"
  | "exits"
  | "access"
  | "organise"
  | "danger";

function readBootstrap(): EditBootstrap | null {
  const node = document.getElementById("edit-bootstrap");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as EditBootstrap;
  } catch {
    return null;
  }
}

export { readBootstrap, FLASH_KEY, OLD_MODE_KEY };
export type { EditBootstrap, ManageContext, OwnedSceneLink };

async function apiJson(
  method: string,
  action: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(action, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : response.statusText);
  }
  return data;
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

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el("label", { class: "edit-field" }, label, control);
}

function jsonField(label: string, name: string, rows: number, value: unknown, example: string, note: string) {
  const fallback = name === "detailsJson" ? {} : [];
  const textarea = el(
    "textarea",
    { name, rows: String(rows), "data-editor": "json" },
    formatJsonTextarea(value ?? fallback),
  );
  const help = el(
    "details",
    { class: "json-format-help" },
    el("summary", { class: "json-format-info", title: `Example ${label}` }, "i"),
    el("div", { class: "json-format-example" }, el("p", { class: "muted" }, note), el("pre", {}, example)),
  );
  const wrap = el("div", { class: "json-field" }, el("div", { class: "json-field-label" }, el("span", {}, label), help), textarea);
  return wrap;
}

function proseTextarea(name: string, rows: number, value: string, required = false): HTMLTextAreaElement {
  return el(
    "textarea",
    {
      name,
      rows: String(rows),
      "data-editor": "prose",
      ...(required ? { required: true } : {}),
    },
    value,
  );
}

function setStatus(root: HTMLElement, message: string, kind: "ok" | "err" = "err"): void {
  let bar = root.querySelector<HTMLElement>(".edit-status");
  if (!bar) {
    bar = el("p", { class: "edit-status" });
    root.prepend(bar);
  }
  bar.textContent = message;
  bar.dataset.kind = kind;
  bar.hidden = !message;
}

function inputValue(root: ParentNode, name: string): string {
  const node = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  return node?.value ?? "";
}

function checked(root: ParentNode, name: string): boolean {
  return !!root.querySelector<HTMLInputElement>(`input[name="${name}"][type="checkbox"]`)?.checked;
}

/** Mount edit tools once into `pane`. Caller places the sidebar toolbar into `#edit-root`. */
export function mountEdit(boot: EditBootstrap, pane: HTMLElement): { toolbar: HTMLElement } {
  const manage = boot.manage;
  const user = boot.user;
  if (!user) {
    pane.replaceChildren(el("p", { class: "muted" }, "Sign in to edit."));
    return { toolbar: el("div") };
  }

  const tools = availableTools(manage, user);
  let active: ToolId = tools.includes("page") ? "page" : "new";

  const toolbar = el("div", { class: "edit-toolbar", role: "toolbar", "aria-label": "Editor" });
  const inspector = el("div", { class: "edit-inspector" });
  const nav = el("nav", { class: "edit-tools", "aria-label": "Editor tools" });
  const panel = el("div", { class: "edit-panel" });

  const sceneTools = el("div", { class: "edit-toolbar-scenes" });
  sceneTools.append(sceneSwitcher(boot.ownedScenes, manage));

  const links = el("div", { class: "edit-toolbar-links" });
  links.append(el("a", { class: "edit-tool-link", href: "g" }, "Groups"));
  if (boot.isModerator) {
    links.append(el("a", { class: "edit-tool-link", href: "live/admin" }, "Live Admin"));
  }
  if (boot.isManager) {
    links.append(
      el("a", { class: "edit-tool-link", href: "msg" }, "Msg"),
      el("a", { class: "edit-tool-link", href: "data" }, "Data"),
      el("a", { class: "edit-tool-link", href: "staff" }, "Staff"),
    );
  }
  toolbar.append(sceneTools, links);

  const flash = sessionStorage.getItem(FLASH_KEY);
  if (flash) {
    sessionStorage.removeItem(FLASH_KEY);
    setStatus(inspector, flash, "err");
  }

  function selectTool(id: ToolId): void {
    active = id;
    for (const btn of Array.from(nav.querySelectorAll<HTMLButtonElement>("button[data-tool]"))) {
      btn.classList.toggle("is-active", btn.dataset.tool === id);
    }
    renderPanel();
  }

  for (const id of tools) {
    const btn = el("button", { type: "button", class: "edit-tool-tab", "data-tool": id }, toolLabel(id, manage));
    btn.addEventListener("click", () => selectTool(id));
    nav.append(btn);
  }

  function renderPanel(): void {
    panel.replaceChildren(toolView(active, boot, inspector));
    for (const btn of Array.from(nav.querySelectorAll<HTMLButtonElement>("button[data-tool]"))) {
      btn.classList.toggle("is-active", btn.dataset.tool === active);
    }
    applyEditorPreferences(panel);
  }

  inspector.append(nav, panel, editorPrefsControls());
  pane.replaceChildren(inspector);
  renderPanel();
  return { toolbar };
}

function toolLabel(id: ToolId, manage?: ManageContext): string {
  switch (id) {
    case "page":
      return manage?.kind === "artefact" ? "Artefact" : "Page";
    case "new":
      return "+ Scene";
    case "artefact":
      return "+ Artefact";
    case "exits":
      return "Exits";
    case "access":
      return "Access";
    case "organise":
      return "Groups";
    case "danger":
      return "Delete";
  }
}

function availableTools(manage?: ManageContext, user?: { username: string }): ToolId[] {
  const tools: ToolId[] = ["new"];
  if (manage?.kind === "scene" && manage.scene && manage.canEdit) tools.unshift("page");
  if (manage?.kind === "artefact" && manage.artefact && manage.canEdit) tools.unshift("page");
  if (manage?.kind === "scene" && manage.canEdit) tools.push("artefact");
  if (manage?.kind === "scene" && manage.scene && (manage.canAddExit || user)) tools.push("exits");
  if (manage?.kind === "scene" && manage.canManage) tools.push("access");
  if (manage?.kind === "scene" && (manage.canManage || manage.canOrganise)) tools.push("organise");
  if (manage?.canDelete) tools.push("danger");
  return tools;
}

function sceneSwitcher(owned: OwnedSceneLink[], manage?: ManageContext): HTMLElement {
  const current = manage?.kind === "scene" ? manage.scene?.id : undefined;
  if (!owned.length) return el("span", { class: "edit-switcher muted" }, "No scenes yet");
  const select = el("select", { class: "edit-switcher", "aria-label": "My scenes" });
  select.append(el("option", { value: "" }, "My scenes"));
  for (const scene of owned) {
    const label = scene.title?.trim() ? scene.title : `Scene ${scene.id}`;
    const opt = el("option", { value: String(scene.id) }, `${scene.id} ${label}`);
    if (scene.id === current) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => {
    if (select.value) window.location.href = `s/${select.value}`;
  });
  return select;
}

function toolView(id: ToolId, boot: EditBootstrap, inspector: HTMLElement): HTMLElement {
  const manage = boot.manage;
  switch (id) {
    case "page":
      return manage?.kind === "artefact" && manage.artefact
        ? artefactEditor(manage, inspector)
        : sceneEditor(manage, inspector);
    case "new":
      return newSceneTool(manage, inspector);
    case "artefact":
      return newArtefactTool(manage, inspector);
    case "exits":
      return exitsTool(manage, inspector, boot.ownedScenes);
    case "access":
      return accessTool(manage, inspector);
    case "organise":
      return organiseTool(manage, inspector);
    case "danger":
      return dangerTool(manage, inspector);
  }
}

function sceneEditor(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  const scene = manage?.scene;
  if (!scene || !manage?.canEdit) {
    return el("p", { class: "muted" }, "You can read this page but not edit it.");
  }
  const form = el("div", { class: "edit-fields" });
  const title = el("input", { name: "title", value: scene.title ?? "" });
  const body = proseTextarea("body", 10, scene.body, true);
  form.append(
    field("Title", title),
    field("Body", body),
    jsonField("Details", "detailsJson", 10, scene.details, DETAILS_EXAMPLE, "Object of named closer-look texts."),
    el(
      "label",
      { class: "edit-check" },
      el("input", {
        type: "checkbox",
        name: "visibility",
        ...(scene.visibility === "public" ? { checked: true } : {}),
      }),
      " Public",
    ),
  );
  if (manage.canManage) {
    form.append(
      el(
        "label",
        { class: "edit-check" },
        el("input", {
          type: "checkbox",
          name: "isJunction",
          ...(scene.isJunction ? { checked: true } : {}),
        }),
        " Public junction",
      ),
    );
  }
  form.append(
    el(
      "label",
      { class: "edit-check" },
      el("input", { type: "checkbox", name: "retainSnapshot" }),
      " Keep version snapshot",
    ),
  );
  const save = el("button", { type: "button" }, "Save page");
  save.addEventListener("click", async () => {
    try {
      await apiJson("PUT", `s/${scene.id}`, {
        title: inputValue(form, "title"),
        body: inputValue(form, "body"),
        detailsJson: inputValue(form, "detailsJson"),
        visibility: checked(form, "visibility") ? "public" : "private",
        isJunction: checked(form, "isJunction"),
        retainSnapshot: checked(form, "retainSnapshot"),
      });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Save failed");
    }
  });
  return el(
    "div",
    { class: "stack" },
    el("p", { class: "edit-kicker" }, `Scene ${scene.id}`),
    form,
    save,
    el("p", { class: "muted" }, el("a", { href: `s/${scene.id}/history` }, "Scene history")),
  );
}

function artefactEditor(manage: ManageContext, inspector: HTMLElement): HTMLElement {
  const artefact = manage.artefact!;
  const form = el("div", { class: "edit-fields" });
  form.append(
    field("Title", el("input", { name: "title", value: artefact.title ?? "" })),
    field("Body", proseTextarea("body", 10, artefact.body, true)),
    field("Home scene", el("input", { name: "homeSceneId", type: "number", value: String(artefact.homeSceneId) })),
    field("Tags", el("input", { name: "tags", value: artefact.tags.join(", ") })),
    jsonField("Details", "detailsJson", 10, artefact.details, DETAILS_EXAMPLE, "Object of named closer-look texts."),
    el(
      "label",
      { class: "edit-check" },
      el("input", { type: "checkbox", name: "retainSnapshot" }),
      " Keep version snapshot",
    ),
  );
  const save = el("button", { type: "button" }, "Save artefact");
  save.addEventListener("click", async () => {
    try {
      await apiJson("PUT", `a/${artefact.id}`, {
        title: inputValue(form, "title"),
        body: inputValue(form, "body"),
        homeSceneId: Number(inputValue(form, "homeSceneId")),
        tags: inputValue(form, "tags"),
        detailsJson: inputValue(form, "detailsJson"),
        retainSnapshot: checked(form, "retainSnapshot"),
      });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Save failed");
    }
  });
  return el(
    "div",
    { class: "stack" },
    el("p", { class: "edit-kicker" }, `Artefact ${artefact.id}`),
    form,
    save,
    el("p", { class: "muted" }, el("a", { href: `a/${artefact.id}/history` }, "Artefact history")),
  );
}

function newSceneTool(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  const fromScene = manage?.kind === "scene" ? manage.scene : undefined;
  const form = el("div", { class: "edit-fields" });
  form.append(
    field("Title", el("input", { name: "title" })),
    field("Body", proseTextarea("body", 10, "", true)),
    el(
      "label",
      { class: "edit-check" },
      el("input", { type: "checkbox", name: "visibility" }),
      " Public",
    ),
  );
  if (fromScene) {
    form.append(
      field("Exit nickname from here", el("input", { name: "nickname", placeholder: "e.g. garden gate" })),
      field("Exit nickname back here", el("input", { name: "returnNickname", placeholder: "e.g. threshold" })),
    );
  }
  const create = el("button", { type: "button" }, "Create scene");
  create.addEventListener("click", async () => {
    const body = inputValue(form, "body").trim();
    if (!body) {
      setStatus(inspector, "Body is required");
      return;
    }
    try {
      const scene = await apiJson("POST", "s", {
        title: inputValue(form, "title"),
        body,
        visibility: checked(form, "visibility") ? "public" : "private",
      });
      const id = Number(scene.id);
      if (fromScene) {
        const nickname = inputValue(form, "nickname").trim();
        const returnNickname = inputValue(form, "returnNickname").trim();
        const failures: string[] = [];
        if (nickname) {
          try {
            await apiJson("POST", `s/${fromScene.id}/exits`, { nickname, toSceneId: id });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Could not add exit";
            failures.push(`from here: ${msg}`);
          }
        }
        if (returnNickname) {
          try {
            await apiJson("POST", `s/${id}/exits`, { nickname: returnNickname, toSceneId: fromScene.id });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Could not add return exit";
            failures.push(`back here: ${msg}`);
          }
        }
        if (failures.length) {
          sessionStorage.setItem(FLASH_KEY, `Scene created, but could not add exit ${failures.join("; ")}`);
        }
      }
      window.location.href = `s/${id}`;
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Create failed");
    }
  });
  return el("div", { class: "stack" }, el("p", { class: "edit-kicker" }, "New scene"), form, create);
}

function newArtefactTool(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  const scene = manage?.scene;
  if (!scene) return el("p", { class: "muted" }, "Open a scene to place an artefact.");
  const form = el("div", { class: "edit-fields" });
  form.append(
    field("Title", el("input", { name: "title" })),
    field("Body", proseTextarea("body", 10, "", true)),
    field("Tags", el("input", { name: "tags", placeholder: "comma separated" })),
  );
  const create = el("button", { type: "button" }, "Create artefact");
  create.addEventListener("click", async () => {
    const body = inputValue(form, "body").trim();
    if (!body) {
      setStatus(inspector, "Body is required");
      return;
    }
    try {
      const artefact = await apiJson("POST", "a", {
        homeSceneId: scene.id,
        title: inputValue(form, "title"),
        body,
        tags: inputValue(form, "tags"),
      });
      window.location.href = `a/${artefact.id}`;
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Create failed");
    }
  });
  return el("div", { class: "stack" }, el("p", { class: "edit-kicker" }, `Artefact in scene ${scene.id}`), form, create);
}

function exitsTool(
  manage: ManageContext | undefined,
  inspector: HTMLElement,
  ownedScenes: OwnedSceneLink[],
): HTMLElement {
  const scene = manage?.scene;
  if (!scene) return el("p", { class: "muted" }, "No scene selected.");

  if (!manage?.canAddExit) {
    const add = el("div", { class: "edit-fields" });
    const dest = el("select", { name: "toSceneId", required: true });
    dest.append(el("option", { value: "" }, "Choose your scene…"));
    for (const owned of ownedScenes) {
      const label = owned.title?.trim() ? owned.title : `Scene ${owned.id}`;
      dest.append(el("option", { value: String(owned.id) }, `${owned.id} ${label}`));
    }
    add.append(
      field("Nickname", el("input", { name: "nickname", required: true })),
      field("To your scene", dest),
      field("Note (optional)", el("textarea", { name: "note", rows: "3" })),
    );
    const requestBtn = el("button", { type: "button" }, "Request exit");
    requestBtn.addEventListener("click", async () => {
      const nickname = inputValue(add, "nickname").trim();
      const toSceneId = Number(inputValue(add, "toSceneId"));
      const note = inputValue(add, "note").trim();
      if (!nickname || !Number.isFinite(toSceneId) || toSceneId < 1) {
        setStatus(inspector, "Nickname and one of your scenes are required");
        return;
      }
      try {
        await apiJson("POST", `s/${scene.id}/exit-requests`, {
          nickname,
          toSceneId,
          ...(note ? { note } : {}),
        });
        setStatus(inspector, "Exit request sent to the scene owner", "ok");
      } catch (err) {
        setStatus(inspector, err instanceof Error ? err.message : "Could not send request");
      }
    });
    if (!ownedScenes.length) {
      return el(
        "div",
        { class: "stack" },
        el("p", { class: "edit-kicker" }, "Request exit"),
        el("p", { class: "muted" }, "Create a scene you own first, then request a link from here."),
      );
    }
    return el(
      "div",
      { class: "stack" },
      el("p", { class: "edit-kicker" }, "Request exit"),
      el(
        "p",
        { class: "muted" },
        "You cannot add exits from this scene. Ask the owner to add one to a scene you own.",
      ),
      add,
      requestBtn,
    );
  }

  const add = el("div", { class: "edit-fields" });
  add.append(
    field("Nickname", el("input", { name: "nickname", required: true })),
    field("To scene id", el("input", { name: "toSceneId", type: "number", min: "1", required: true })),
  );
  const addBtn = el("button", { type: "button" }, "Add exit");
  addBtn.addEventListener("click", async () => {
    const nickname = inputValue(add, "nickname").trim();
    const toSceneId = Number(inputValue(add, "toSceneId"));
    if (!nickname || !Number.isFinite(toSceneId)) {
      setStatus(inspector, "Nickname and destination are required");
      return;
    }
    try {
      await apiJson("POST", `s/${scene.id}/exits`, { nickname, toSceneId });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Could not add exit");
    }
  });

  const removable = (manage.exits ?? []).filter((exit) => exit.canRemove);
  const list = el("ul", { class: "link-list manage-exit-list" });
  for (const exit of removable) {
    list.append(
      el(
        "li",
        {},
        el(
          "label",
          { class: "exit-remove-item" },
          el("input", { type: "checkbox", name: "exitId", value: String(exit.exitId) }),
          ` ${exit.nickname} `,
          el("span", { class: "muted" }, `→ ${exit.toSceneId}`),
        ),
      ),
    );
  }
  const removeBtn = el("button", { type: "button", class: "edit-danger" }, "Remove selected");
  removeBtn.addEventListener("click", async () => {
    const ids = Array.from(list.querySelectorAll<HTMLInputElement>('input[name="exitId"]:checked')).map(
      (n) => n.value,
    );
    if (!ids.length) {
      setStatus(inspector, "Select at least one exit");
      return;
    }
    if (!window.confirm("Remove the selected exits?")) return;
    try {
      await apiJson("POST", `s/${scene.id}/exits/delete`, { exitId: ids });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Could not remove exits");
    }
  });

  const wrap = el("div", { class: "stack" }, el("p", { class: "edit-kicker" }, "Add exit"), add, addBtn);
  if (removable.length) {
    wrap.append(el("p", { class: "edit-kicker" }, "Remove exits"), list, removeBtn);
  }
  return wrap;
}

function accessTool(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  const scene = manage?.scene;
  if (!scene || !manage?.canManage) return el("p", { class: "muted" }, "Manage rights required.");
  const form = el("div", { class: "edit-fields" });
  form.append(
    el("p", { class: "muted" }, "who + rights (read/edit/manage). Use * for everyone."),
    jsonField("Grants", "grantsJson", 10, scene.grants ?? [], GRANTS_EXAMPLE, "Array of { who, rights }."),
    jsonField("Denies", "deniesJson", 10, scene.denies ?? [], DENIES_EXAMPLE, "Array of { who, rights? }. Omit rights to deny all."),
  );
  const save = el("button", { type: "button" }, "Save access");
  save.addEventListener("click", async () => {
    try {
      await apiJson("PUT", `s/${scene.id}/access`, {
        grantsJson: inputValue(form, "grantsJson"),
        deniesJson: inputValue(form, "deniesJson"),
      });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Save failed");
    }
  });
  const wrap = el(
    "div",
    { class: "stack" },
    el("p", { class: "edit-kicker" }, `Access for scene ${scene.id}`),
    el("p", { class: "muted" }, "Owner: ", scene.owner ? el("a", { href: `u/${encodeURIComponent(scene.owner)}` }, scene.owner) : "unknown"),
    form,
    save,
  );
  const grouped = manage.sceneGroup ?? (scene.groupId ? { id: scene.groupId, title: `Group ${scene.groupId}` } : undefined);
  if (grouped) {
    wrap.append(
      el("p", { class: "edit-kicker" }, "Transfer ownership"),
      el(
        "p",
        { class: "muted" },
        "This scene is in ",
        el("a", { href: `g/${grouped.id}` }, grouped.title),
        ". Transfer the group.",
      ),
    );
  } else if (manage.canTransfer) {
    const xfer = el("div", { class: "edit-fields" });
    xfer.append(
      field("New owner", el("input", { name: "to", autocomplete: "username" })),
      el(
        "label",
        { class: "edit-check" },
        el("input", { type: "checkbox", name: "keepAccess", checked: true }),
        " Keep my access",
      ),
    );
    const transfer = el("button", { type: "button" }, "Transfer");
    transfer.addEventListener("click", async () => {
      const to = inputValue(xfer, "to").trim();
      if (!to) {
        setStatus(inspector, "Recipient username is required");
        return;
      }
      try {
        await apiJson("POST", `s/${scene.id}/transfer`, {
          to,
          keepAccess: checked(xfer, "keepAccess"),
        });
        window.location.reload();
      } catch (err) {
        setStatus(inspector, err instanceof Error ? err.message : "Transfer failed");
      }
    });
    wrap.append(el("p", { class: "edit-kicker" }, "Transfer ownership"), xfer, transfer);
  } else {
    wrap.append(
      el("p", { class: "edit-kicker" }, "Transfer ownership"),
      el("p", { class: "muted" }, "Only the owner or a manager can transfer this scene."),
    );
  }
  return wrap;
}

function organiseTool(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  const scene = manage?.scene;
  if (!scene || !(manage?.canManage || manage?.canOrganise)) {
    return el("p", { class: "muted" }, "Organise rights required.");
  }
  const wrap = el("div", { class: "stack" });
  if (manage.canManage) {
    const groupSelect = el("select", { name: "groupId" });
    groupSelect.append(el("option", { value: "none", ...(scene.groupId ? {} : { selected: true }) }, "(none)"));
    for (const group of manage.groups ?? []) {
      groupSelect.append(
        el(
          "option",
          { value: group.id, ...(scene.groupId === group.id ? { selected: true } : {}) },
          `${group.title} (#${group.id})`,
        ),
      );
    }
    const assign = el("button", { type: "button" }, "Assign group");
    assign.addEventListener("click", async () => {
      try {
        await apiJson("POST", `s/${scene.id}/group`, { groupId: groupSelect.value });
        window.location.reload();
      } catch (err) {
        setStatus(inspector, err instanceof Error ? err.message : "Could not assign group");
      }
    });
    wrap.append(el("p", { class: "edit-kicker" }, "Scene group"), field("Group", groupSelect), assign);
    if (scene.groupId) {
      wrap.append(
        el(
          "p",
          {},
          el("a", { href: `g/${encodeURIComponent(scene.groupId)}` }, "Edit this group's access"),
        ),
      );
    }
  }

  const newTitle = el("input", { name: "groupTitle" });
  const createGroup = el("button", { type: "button" }, "Create group");
  createGroup.addEventListener("click", async () => {
    const title = newTitle.value.trim();
    if (!title) {
      setStatus(inspector, "Title is required");
      return;
    }
    try {
      await apiJson("POST", "g", { title });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Could not create group");
    }
  });
  wrap.append(el("p", { class: "edit-kicker" }, "New group"), field("Title", newTitle), createGroup);

  const egSelect = el("select", { name: "entranceGroupId" });
  egSelect.append(
    el("option", { value: "none", ...(scene.entranceGroupId ? {} : { selected: true }) }, "(none)"),
  );
  for (const group of manage.entranceGroups ?? []) {
    egSelect.append(
      el(
        "option",
        {
          value: group.id,
          ...(scene.entranceGroupId === group.id ? { selected: true } : {}),
        },
        `${group.title} (#${group.id}, entrance ${group.entranceSceneId})`,
      ),
    );
  }
  const assignEg = el("button", { type: "button" }, "Assign entrance group");
  assignEg.addEventListener("click", async () => {
    try {
      await apiJson("POST", `s/${scene.id}/entrance-group`, { entranceGroupId: egSelect.value });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Could not assign entrance group");
    }
  });
  wrap.append(
    el("p", { class: "edit-kicker" }, "Entrance group"),
    el("p", { class: "muted" }, "Teleporting into this set from outside lands at the entrance scene."),
    field("Group", egSelect),
    assignEg,
  );

  const egTitle = el("input", { name: "egTitle" });
  const createEg = el("button", { type: "button" }, "Create with this scene as entrance");
  createEg.addEventListener("click", async () => {
    const title = egTitle.value.trim();
    if (!title) {
      setStatus(inspector, "Title is required");
      return;
    }
    try {
      await apiJson("POST", "eg", { title, entranceSceneId: scene.id });
      window.location.reload();
    } catch (err) {
      setStatus(inspector, err instanceof Error ? err.message : "Could not create entrance group");
    }
  });
  wrap.append(el("p", { class: "edit-kicker" }, "New entrance group"), field("Title", egTitle), createEg);
  return wrap;
}

function dangerTool(manage: ManageContext | undefined, inspector: HTMLElement): HTMLElement {
  if (manage?.kind === "scene" && manage.scene && manage.canDelete) {
    const btn = el("button", { type: "button", class: "edit-danger" }, `Delete scene ${manage.scene.id}`);
    btn.addEventListener("click", async () => {
      if (
        !window.confirm(
          `Delete scene ${manage.scene!.id}? Homed artefacts and inbound exits will be removed.`,
        )
      ) {
        return;
      }
      try {
        await apiJson("POST", `s/${manage.scene!.id}/delete`);
        window.location.href = "./";
      } catch (err) {
        setStatus(inspector, err instanceof Error ? err.message : "Delete failed");
      }
    });
    return el("div", { class: "stack" }, el("p", { class: "edit-kicker" }, "Delete scene"), btn);
  }
  if (manage?.kind === "artefact" && manage.artefact && manage.canDelete) {
    const btn = el("button", { type: "button", class: "edit-danger" }, "Delete artefact");
    btn.addEventListener("click", async () => {
      if (!window.confirm(`Delete artefact ${manage.artefact!.id}?`)) return;
      try {
        await apiJson("POST", `a/${manage.artefact!.id}/delete`);
        window.location.href = "./";
      } catch (err) {
        setStatus(inspector, err instanceof Error ? err.message : "Delete failed");
      }
    });
    return el("div", { class: "stack" }, el("p", { class: "edit-kicker" }, "Delete artefact"), btn);
  }
  return el("p", { class: "muted" }, "Nothing to delete here.");
}
