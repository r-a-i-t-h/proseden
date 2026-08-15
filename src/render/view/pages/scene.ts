import type {
  ArtefactRecord,
  ExitRecord,
  SceneRecord,
} from "../../../model/types.js";
import { entityKindLabel, entityPath } from "../../entity.js";
import {
  button,
  byline,
  crumb,
  entityTitle,
  field,
  form,
  fragment,
  htmlOnly,
  linkList,
  meta,
  nodes,
  pageView,
  prose,
  rawText,
  script,
  section,
  textOnly,
} from "../factories.js";
import type { Node, PageView } from "../types.js";

const SCENE_ACTION_SCRIPT = `(function () {
        var travel = document.getElementById("travel-form");
        if (travel) {
          travel.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var to = travel.querySelector('input[name="to"]').value;
            var from = travel.querySelector('input[name="from"]').value;
            if (!to) return;
            window.location.href = "s/" + encodeURIComponent(to) + "?from=" + encodeURIComponent(from);
          });
        }
        var invite = document.getElementById("invite-form");
        if (invite) {
          invite.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var username = invite.querySelector('input[name="username"]').value.trim();
            if (!username) return;
            var body = new URLSearchParams();
            body.set("username", username);
            fetch(invite.action, {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
              body: body,
            }).then(function (r) {
              return r.json().then(function (data) {
                if (r.ok) {
                  invite.querySelector('input[name="username"]').value = "";
                  alert((data.toUser || username) + " has been invited to view this scene");
                } else {
                  alert(data.error || "Invalid username");
                }
              });
            });
          });
        }
      })();`;

function namedDetails(
  kind: "scene" | "artefact",
  id: number,
  details: Record<string, string>,
): Node[] {
  const names = Object.keys(details);
  if (!names.length) return [];
  const path = entityPath(kind, id);
  return [
    section("Details", [
      linkList(
        names.map((name) => ({
          href: `${path}?${encodeURIComponent(name)}`,
          label: name,
        })),
      ),
    ]),
  ];
}

export function entityDetailView(opts: {
  kind: "scene" | "artefact";
  id: number;
  title?: string;
  owner: string;
  detail: string;
  text?: string;
}): PageView {
  const path = entityPath(opts.kind, opts.id);
  const htmlText = opts.text ?? `No detail named “${opts.detail}”.`;
  const plainText = opts.text ?? `(No detail named "${opts.detail}".)`;
  return pageView(`${entityKindLabel(opts.kind)} ${opts.id}`, [
    crumb(path, `← ${entityKindLabel(opts.kind)} ${opts.id}`),
    entityTitle(opts.kind, opts.id, opts.title, opts.detail),
    byline(opts.owner),
    htmlOnly(prose(htmlText)),
    textOnly(rawText(["", plainText])),
  ]);
}

export function scenePageView(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  isEntrance?: boolean;
  accessSummary?: string;
}): PageView {
  const { scene, exits, artefacts, detail, isEntrance } = opts;
  const title = scene.title ?? `Scene ${scene.id}`;

  if (detail) {
    return entityDetailView({
      kind: "scene",
      id: scene.id,
      title: scene.title,
      owner: scene.owner,
      detail,
      text: scene.details[detail],
    });
  }

  const publicJunction = Boolean(scene.isJunction && scene.visibility === "public");
  const badges = [
    scene.visibility,
    publicJunction ? "junction" : "",
    isEntrance ? "entrance" : "",
  ].filter(Boolean);

  const artefactSection = artefacts.length
    ? fragment(
        htmlOnly(
          section("Artefacts", [
            linkList(
              artefacts.map((a) => ({
                href: `a/${a.id}`,
                label: a.title ?? `Artefact ${a.id}`,
              })),
            ),
          ]),
        ),
        textOnly(
          section("Artefacts", [
            linkList(
              artefacts.map((a) => ({
                href: `a/${a.id}`,
                label: a.title ?? `artefact ${a.id}`,
                textId: a.id,
              })),
            ),
          ]),
        ),
      )
    : undefined;

  return pageView(
    title,
    nodes(
      entityTitle("scene", scene.id, scene.title),
      byline(scene.owner),
      htmlOnly(meta(...badges)),
      textOnly(rawText([`visibility: ${badges.join(" · ")}`, ""])),
      htmlOnly(prose(scene.body)),
      textOnly(rawText([scene.body, ""])),
      ...namedDetails("scene", scene.id, scene.details),
      artefactSection,
      exits.length
        ? section("Exits", [
            linkList(
              exits.map((e) => ({
                href: `s/${scene.id}/go/${e.exitId}`,
                label: e.nickname,
              })),
            ),
          ])
        : undefined,
      htmlOnly(
        section("Actions", [
          form(
            { method: "get", action: "s/", class: "action-form", id: "travel-form" },
            field("Teleport to scene id:", {
              type: "number",
              name: "to",
              required: true,
              min: "1",
            }),
            {
              type: "field",
              label: "",
              control: { type: "hidden", name: "from", value: String(scene.id) },
            },
            button("Go"),
          ),
          form(
            {
              method: "post",
              action: `s/${scene.id}/view-invites`,
              class: "action-form",
              id: "invite-form",
            },
            field("Invite to view, user:", {
              type: "text",
              name: "username",
              required: true,
            }),
            button("Invite"),
          ),
        ]),
        script(SCENE_ACTION_SCRIPT),
      ),
      textOnly({
        type: "actionRecipes",
        recipes: [
          `Teleport: GET {base}/s/<id>?from=${scene.id}`,
          `Invite to view: POST {base}/s/${scene.id}/view-invites`,
        ],
      }),
      opts.accessSummary
        ? textOnly(
            rawText([
              "Access:",
              ...opts.accessSummary.split("\n").map((line) => `  ${line}`),
              "",
            ]),
          )
        : undefined,
    ),
  );
}

export { namedDetails };
