import { formatAccessSummary } from "../../../access/acl.js";
import type { Deny, Grant } from "../../../model/types.js";
import {
  button,
  byline,
  crumb,
  field,
  form,
  heading,
  linkList,
  muted,
  nodes,
  notice,
  pageView,
  para,
  rawText,
  section,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import { accessForm, transferForm } from "./access.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export type GroupListItem = {
  id: string;
  title: string;
  owner: string;
  sceneCount: number;
};

function groupItems(groups: GroupListItem[]) {
  return groups.map((group) => ({
    href: `g/${encodeURIComponent(group.id)}`,
    label: group.title,
    note: `#${group.id} · ${group.owner} · ${group.sceneCount === 1 ? "1 scene" : `${group.sceneCount} scenes`}`,
    noteHtml: undefined as string | undefined,
  }));
}

export function groupsIndexPageView(opts: {
  managed: GroupListItem[];
  readable: GroupListItem[];
  back?: PageBackLink;
}): PageView {
  return pageView(
    "Groups",
    nodes(
      backCrumb(opts.back),
      heading(1, "Groups"),
      muted("Rights on a group apply to every scene in it."),
      opts.managed.length
        ? section("Groups you manage", [linkList(groupItems(opts.managed))])
        : undefined,
      opts.readable.length
        ? section("Other groups you can see", [linkList(groupItems(opts.readable))])
        : undefined,
      heading(2, "New group"),
      form(
        { method: "post", action: "g", class: "profile-form" },
        field("Title", { type: "text", name: "title", required: true }),
        button("Create group"),
      ),
      textOnly(
        rawText([
          "[Groups]",
          "",
          ...opts.managed.map(
            (g) =>
              `  ${g.id}. ${g.title} (${g.owner}, ${g.sceneCount} scenes)  {base}/g/${g.id}`,
          ),
          ...opts.readable.map(
            (g) =>
              `  ${g.id}. ${g.title} (${g.owner}, ${g.sceneCount} scenes)  {base}/g/${g.id}`,
          ),
          "",
          "Create: POST {base}/g  title",
        ]),
      ),
    ),
  );
}

export function groupPageView(opts: {
  id: string;
  title: string;
  owner: string;
  scenes: Array<{ id: number; title?: string }>;
  grants?: Grant[];
  denies?: Deny[];
  canManage: boolean;
  canTransfer?: boolean;
  accessSummary: string;
  message?: string;
  back?: PageBackLink;
}): PageView {
  const scenes = opts.scenes.length
    ? linkList(
        opts.scenes.map((scene) => ({
          href: `s/${scene.id}`,
          label: scene.title?.trim() ? scene.title : `Scene ${scene.id}`,
          note: `#${scene.id}`,
        })),
      )
    : para("No scenes in this group yet. Assign one from Edit → Groups.", "muted");

  return pageView(
    opts.title,
    nodes(
      backCrumb(opts.back),
      crumb("g", "← Groups"),
      heading(1, opts.title, { sub: `#${opts.id}` }),
      byline(opts.owner),
      opts.message ? notice(opts.message) : undefined,
      heading(2, "Scenes"),
      scenes,
      heading(2, "Access"),
      opts.canManage
        ? nodes(
            muted("Anyone granted rights here can use them on every scene in this group."),
            accessForm(
              `g/${encodeURIComponent(opts.id)}/access`,
              opts.grants,
              opts.denies,
              "Save group access",
            ),
          )
        : { type: "pre", text: opts.accessSummary || formatAccessSummary(opts.grants, opts.denies), class: "desc" },
      opts.canTransfer
        ? transferForm(`g/${encodeURIComponent(opts.id)}/transfer`, opts.owner, "group")
        : undefined,
    ),
  );
}
