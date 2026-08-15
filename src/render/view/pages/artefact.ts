import type { ArtefactRecord } from "../../../model/types.js";
import {
  button,
  byline,
  crumb,
  entityTitle,
  form,
  htmlOnly,
  meta,
  nodes,
  pageView,
  prose,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import { entityDetailView, namedDetails } from "./scene.js";

export function artefactPageView(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  collected?: boolean;
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
    });
  }

  const collect =
    opts.collected === undefined
      ? undefined
      : opts.collected
        ? htmlOnly(
            form(
              {
                method: "post",
                action: `a/${artefact.id}/collect/drop`,
                class: "reader-action",
              },
              button("Remove from inventory"),
            ),
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

  return pageView(
    title,
    nodes(
      // Crumb is HTML-oriented; text mode shows home: line instead
      htmlOnly(
        crumb(
          `s/${artefact.homeSceneId}?from=${artefact.homeSceneId}`,
          `← Scene ${artefact.homeSceneId}`,
        ),
      ),
      entityTitle("artefact", artefact.id, artefact.title),
      byline(artefact.owner),
      textOnly(
        rawText([
          `home: {base}/s/${artefact.homeSceneId}?from=${artefact.homeSceneId}`,
        ]),
      ),
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
