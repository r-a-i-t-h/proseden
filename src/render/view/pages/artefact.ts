import type { ArtefactRecord } from "../../../model/types.js";
import {
  box,
  button,
  byline,
  crumb,
  entityTitle,
  form,
  fragment,
  htmlOnly,
  meta,
  nodes,
  notice,
  pageView,
  prose,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import type { PageBackLink } from "./profile.js";
import { entityDetailView, namedDetails } from "./scene.js";

/** Default crumb: artefact's home scene (used when no Live-bound scene). */
export function artefactHomeBackLink(artefact: ArtefactRecord): PageBackLink {
  return {
    href: `s/${artefact.homeSceneId}?from=${artefact.homeSceneId}`,
    label: `← Scene ${artefact.homeSceneId}`,
  };
}

export function artefactPageView(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  collected?: boolean;
  /** Prefer Live-bound scene (inventory/profile style); defaults to home. */
  back?: PageBackLink;
  notice?: string;
}): PageView {
  const { artefact, detail } = opts;
  const title = artefact.title ?? `Artefact ${artefact.id}`;

  if (detail) {
    return entityDetailView({
      kind: "artefact",
      id: artefact.id,
      title: artefact.title,
      owner: artefact.owner,
      detail,
      text: artefact.details[detail],
      notice: opts.notice,
    });
  }

  const back = opts.back ?? artefactHomeBackLink(artefact);
  const home = artefactHomeBackLink(artefact);

  const collect =
    opts.collected === undefined
      ? undefined
      : opts.collected
        ? fragment(
            htmlOnly(
              box(
                "reader-action",
                form(
                  {
                    method: "post",
                    action: `a/${artefact.id}/use`,
                    class: "reader-action",
                  },
                  button("Use"),
                ),
                form(
                  {
                    method: "post",
                    action: `a/${artefact.id}/collect/drop`,
                    class: "reader-action",
                  },
                  button("Remove from inventory"),
                ),
              ),
            ),
            textOnly(rawText([`Use: POST {base}/a/${artefact.id}/use`])),
          )
        : htmlOnly(
            form(
              {
                method: "post",
                action: `a/${artefact.id}/collect`,
                class: "reader-action",
              },
              button("Collect"),
            ),
          );

  const flash =
    opts.notice !== undefined
      ? fragment(htmlOnly(notice(opts.notice)), textOnly(rawText([opts.notice, ""])))
      : undefined;

  const textNav: string[] = [];
  if (opts.back) {
    textNav.push(`${back.label}  {base}/${back.href.replace(/^\.\//, "")}`);
  }
  textNav.push(`home: {base}/${home.href}`);

  return pageView(
    title,
    nodes(
      htmlOnly(crumb(back.href, back.label, back.history)),
      flash,
      entityTitle("artefact", artefact.id, artefact.title),
      byline(artefact.owner),
      textOnly(rawText(textNav)),
      artefact.tags.length ? htmlOnly(meta(artefact.tags.join(", "))) : undefined,
      artefact.tags.length
        ? textOnly(rawText([`tags: ${artefact.tags.join(", ")}`]))
        : undefined,
      htmlOnly(prose(artefact.body)),
      textOnly(rawText(["", artefact.body, ""])),
      ...namedDetails("artefact", artefact.id, artefact.details),
      collect,
    ),
  );
}
