import { escapeHtml } from "../../prose.js";
import { grantTimeHtml, grantTimeLabel } from "../../relative-age.js";
import {
  crumb,
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
import { backCrumb, type PageBackLink } from "./profile.js";

export function userProfilePageView(opts: {
  username: string;
  description: string;
  details: Record<string, string>;
  detail?: string;
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
  badges?: Array<{ id: string; title: string; grantTime?: string | null }>;
  back?: PageBackLink;
}): PageView {
  const path = `u/${encodeURIComponent(opts.username)}`;
  if (opts.detail) {
    const text = opts.details[opts.detail];
    const htmlText = text ?? `No detail named “${opts.detail}”.`;
    const plainText = text ?? `(No detail named "${opts.detail}".)`;
    return pageView(
      opts.username,
      nodes(
        backCrumb(opts.back),
        crumb(path, `← ${opts.username}`),
        heading(1, opts.username, { detailSub: opts.detail }),
        htmlOnly(prose(htmlText)),
        textOnly(rawText(["", plainText])),
      ),
    );
  }

  const desc = opts.description.trim();
  const badges = opts.badges ?? [];
  const metaParts = userMetaParts(opts);

  return pageView(
    opts.username,
    nodes(
      backCrumb(opts.back),
      heading(1, opts.username),
      metaParts.length ? meta(...metaParts) : undefined,
      desc ? prose(desc) : para("No description yet.", "muted"),
      Object.keys(opts.details).length
        ? linkList(
            Object.keys(opts.details).map((name) => ({
              href: `${path}?${encodeURIComponent(name)}`,
              label: name,
            })),
          )
        : undefined,
      badges.length
        ? nodes(
            heading(2, "Badges"),
            linkList(
              badges.map((b) => ({
                href: path,
                label: b.title,
                note: `(${b.id}) · ${grantTimeLabel(b.grantTime ?? undefined)}`,
                noteHtml: `(${escapeHtml(b.id)}) · ${grantTimeHtml(b.grantTime ?? undefined)}`,
              })),
            ),
          )
        : undefined,
    ),
  );
}

function userMetaParts(opts: {
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
}) {
  const parts: Array<string | { type: "labeledAge"; label: string; iso: string }> = [];
  if (opts.ownedScenes !== undefined) {
    parts.push(`${opts.ownedScenes} ${opts.ownedScenes === 1 ? "scene" : "scenes"}`);
  }
  if (opts.ownedArtefacts !== undefined) {
    parts.push(`${opts.ownedArtefacts} ${opts.ownedArtefacts === 1 ? "artefact" : "artefacts"}`);
  }
  if (opts.lastSeenAt) {
    parts.push({ type: "labeledAge", label: "last seen ", iso: opts.lastSeenAt });
  }
  return parts;
}
