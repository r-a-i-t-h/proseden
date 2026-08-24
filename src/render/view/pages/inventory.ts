import type { ArtefactRecord } from "../../../model/types.js";
import {
  button,
  detailsSection,
  field,
  form,
  heading,
  htmlOnly,
  linkList,
  muted,
  nodes,
  notice,
  pageView,
  para,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export function inventoryPageView(
  items: ArtefactRecord[],
  back?: PageBackLink,
  alchemy?: { alchemyOk?: string; alchemyError?: string },
): PageView {
  const list = items.length
    ? linkList(
        items.map((artefact) => ({
          href: `a/${artefact.id}`,
          label: artefact.title ?? `Artefact ${artefact.id}`,
          note: artefact.tags.length ? artefact.tags.join(", ") : undefined,
          textId: artefact.id,
        })),
      )
    : para("Empty — collect artefacts you love.", "muted");

  const flash = alchemy?.alchemyOk
    ? notice(alchemy.alchemyOk)
    : alchemy?.alchemyError
      ? notice(alchemy.alchemyError, "error")
      : undefined;

  const picks = items.length < 2
    ? para("Collect at least two artefacts to attempt alchemy.", "muted")
    : form(
        { method: "post", action: "alchemy/combine", class: "alchemy-form" },
        {
          type: "box",
          class: "alchemy-pick-list",
          children: items.map((a) =>
            field("", {
              type: "checkbox",
              name: "artefactId",
              value: String(a.id),
              label: a.title ?? `Artefact ${a.id}`,
              class: "alchemy-pick",
            }),
          ),
        },
        button("Combine selected"),
      );

  const textLines = ["[Inventory]", ""];
  if (alchemy?.alchemyOk) textLines.push(alchemy.alchemyOk, "");
  else if (alchemy?.alchemyError) textLines.push(alchemy.alchemyError, "");
  textLines.push(
    items.length
      ? items
          .map((a) => {
            const label = a.title ?? `artefact ${a.id}`;
            const tags = a.tags.length ? ` [${a.tags.join(", ")}]` : "";
            return `  ${a.id}. ${label}${tags}  {base}/a/${a.id}`;
          })
          .join("\n")
      : "(empty)",
  );

  return pageView(
    "Inventory",
    nodes(
      backCrumb(back),
      heading(1, "Inventory"),
      flash,
      list,
      htmlOnly(
        detailsSection(
          "Alchemy",
          nodes(
            muted("Select two or more holdings and combine them. Recipes are world-defined."),
            picks,
          ),
          {
            class: "alchemy-panel",
            attrs: { "data-persist-open": "proseden-alchemy-open" },
          },
        ),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}
