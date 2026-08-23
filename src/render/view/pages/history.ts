import type { EditLogEntry, EntityKind } from "../../../model/types.js";
import { entityKindLabel, entityPath } from "../../entity.js";
import {
  button,
  crumb,
  form,
  heading,
  htmlOnly,
  linkList,
  meta,
  nodes,
  pageView,
  para,
  prose,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";

export function editHistoryPageView(opts: {
  kind: EntityKind;
  id: number;
  log: EditLogEntry[];
}): PageView {
  const path = entityPath(opts.kind, opts.id);
  const title = `History · ${entityKindLabel(opts.kind)} ${opts.id}`;
  return pageView(
    title,
    nodes(
      crumb(path, `← ${entityKindLabel(opts.kind)} ${opts.id}`),
      heading(1, "History"),
      opts.log.length
        ? linkList(
            opts.log.map((e) => ({
              href: e.versionId
                ? `${path}/history/${encodeURIComponent(e.versionId)}`
                : path,
              label: e.at,
              note: `${e.by} · ${e.fields.join(", ") || "—"}${e.retained ? " · retained" : ""}`,
            })),
          )
        : para("No edits logged.", "muted"),
      textOnly(
        rawText([
          `[${title}]`,
          "",
          opts.log.length
            ? opts.log
                .map((e) => {
                  const snap = e.versionId
                    ? `  snapshot: {base}/${path}/history/${encodeURIComponent(e.versionId)}`
                    : "";
                  return `${e.at} by ${e.by}  {base}/u/${encodeURIComponent(e.by)} [${e.fields.join(", ") || "—"}]${e.retained ? " (retained)" : ""}${snap ? `\n${snap}` : ""}`;
                })
                .join("\n")
            : "(no edits logged)",
        ]),
      ),
    ),
  );
}

export function snapshotPageView(opts: {
  kind: EntityKind;
  id: number;
  versionId: string;
  body: string;
  title?: string;
  canRestore: boolean;
}): PageView {
  const path = entityPath(opts.kind, opts.id);
  return pageView(
    `Snapshot ${opts.versionId}`,
    nodes(
      crumb(`${path}/history`, "← History"),
      heading(1, "Snapshot", { sub: opts.versionId }),
      opts.kind === "scene" ? meta(opts.title ?? `Scene ${opts.id}`) : undefined,
      htmlOnly(prose(opts.body)),
      opts.canRestore
        ? form(
            {
              method: "post",
              action: `${path}/history/${encodeURIComponent(opts.versionId)}/restore`,
              class: "stack",
            },
            button("Restore this version"),
          )
        : undefined,
      textOnly(
        rawText([
          opts.kind === "scene" ? `${opts.title ?? `Scene ${opts.id}`}\n\n${opts.body}` : opts.body,
        ]),
      ),
    ),
  );
}
