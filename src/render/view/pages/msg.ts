import {
  button,
  field,
  form,
  heading,
  htmlOnly,
  muted,
  nodes,
  notice,
  pageView,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export function msgPageView(opts: {
  usernames: string[];
  selected?: string;
  body?: string;
  notice?: string;
  error?: string;
  back?: PageBackLink;
}): PageView {
  const selected = opts.selected ?? "";
  const options = [
    { value: "", label: "Choose recipient…", disabled: true, selected: !selected },
    { value: "*", label: "ALL users", selected: selected === "*" },
    ...opts.usernames.map((name) => ({
      value: name,
      label: name,
      selected: selected === name,
    })),
  ];

  const flash = opts.error
    ? notice(opts.error, "error")
    : opts.notice
      ? notice(opts.notice)
      : undefined;

  const textLines: string[] = ["[Msg]", ""];
  if (opts.back) {
    textLines.push(`${opts.back.label}  {base}/${opts.back.href.replace(/^\.\//, "")}`, "");
  }
  if (opts.error || opts.notice) {
    textLines.push(opts.error ?? opts.notice!, "");
  }
  textLines.push(
    "Send a free-text note to one reader or everyone.",
    "Line breaks and prose adornments are kept: _emphasis_, *bold*, ~strike~, ---, and [links](https://…).",
    "",
    "POST {base}/msg",
    "  to: username or * (ALL users)",
    "  body: message text",
    "",
    "Users:",
  );
  if (!opts.usernames.length) textLines.push("  (none)");
  else for (const name of opts.usernames) textLines.push(`  ${name}`);

  return pageView(
    "Msg",
    nodes(
      htmlOnly(
        ...nodes(
          backCrumb(opts.back),
          heading(1, "Msg"),
          muted(
            "Send a free-text note to one reader or everyone. Line breaks and prose adornments are kept: _emphasis_, *bold*, ~strike~, ---, and [links](https://…).",
          ),
          flash,
          form(
            {
              method: "post",
              action: "msg",
              class: "profile-form profile-appearance",
              id: "msg-form",
            },
            field("To", {
              type: "select",
              name: "to",
              required: true,
              options,
            }),
            field("Message", {
              type: "textarea",
              name: "body",
              value: opts.body ?? "",
              rows: 12,
              required: true,
              editor: "prose",
            }),
            button("Send"),
          ),
        ),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}
