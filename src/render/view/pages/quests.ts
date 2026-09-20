import type { UserBadge } from "../../../model/types.js";
import type { FlagValue } from "../../../model/logic.js";
import {
  button,
  detailsSection,
  form,
  heading,
  htmlOnly,
  jsonField,
  muted,
  nodes,
  notice,
  pageView,
  rawText,
  textOnly,
} from "../factories.js";
import type { Node, PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

function editorPanel(
  summary: string,
  storageKey: string,
  children: Node[],
  open = false,
): Node {
  return detailsSection(summary, children, {
    open,
    class: "quests-panel",
    attrs: { "data-persist-open": storageKey },
  });
}

export function questsPageView(opts: {
  username: string;
  quest: unknown;
  flags: Record<string, FlagValue>;
  badges: UserBadge[];
  questExample: string;
  questNote: string;
  flagsExample: string;
  flagsNote: string;
  badgesExample: string;
  badgesNote: string;
  questRaw?: string;
  notice?: string;
  back?: PageBackLink;
}): PageView {
  const { username } = opts;
  return pageView(
    "Quests",
    nodes(
      backCrumb(opts.back),
      heading(1, "Your quests"),
      muted(
        `Personal quest file quests/users/${username}.json (namespace user.${username}.*). ` +
          `Flags and badges: users/${username}.flags.json and users/${username}.badges.json.`,
      ),
      opts.notice ? notice(opts.notice) : undefined,
      htmlOnly(
        editorPanel(
          "Quests editor",
          "proseden-quests-editor-open",
          nodes(
            muted(`Evaluated after manager quests. Namespace is user.${username}.*.`),
            form(
              { method: "post", action: "quests", class: "stack" },
              jsonField(
                "Quest JSON",
                "questJson",
                opts.quest,
                opts.questExample,
                opts.questNote,
                28,
                opts.questRaw,
              ),
              button("Save"),
            ),
          ),
          true,
        ),
        editorPanel(
          "Flags editor",
          "proseden-flags-editor-open",
          nodes(
            muted(
              `Your set flags only (true). Delete a key to clear it. File: users/${username}.flags.json.`,
            ),
            form(
              { method: "post", action: "quests/flags", class: "stack" },
              jsonField(
                "Flags JSON",
                "flagsJson",
                opts.flags,
                opts.flagsExample,
                opts.flagsNote,
                16,
              ),
              button("Save"),
            ),
          ),
        ),
        editorPanel(
          "Badges editor",
          "proseden-badges-editor-open",
          nodes(
            muted(
              `Badges on your profile shelf. File: users/${username}.badges.json.`,
            ),
            form(
              { method: "post", action: "quests/badges", class: "stack" },
              jsonField(
                "Badges JSON",
                "badgesJson",
                opts.badges,
                opts.badgesExample,
                opts.badgesNote,
                16,
              ),
              button("Save"),
            ),
          ),
        ),
      ),
      textOnly(
        rawText([
          "[Quests editor]",
          "",
          opts.questRaw ?? JSON.stringify(opts.quest, null, 2),
          "",
          "[Flags editor]",
          "",
          JSON.stringify(opts.flags, null, 2),
          "",
          "[Badges editor]",
          "",
          JSON.stringify(opts.badges, null, 2),
        ]),
      ),
    ),
  );
}
