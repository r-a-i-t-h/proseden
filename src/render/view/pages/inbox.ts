import type { InboxMessage } from "../../../model/types.js";
import {
  article,
  box,
  button,
  form,
  heading,
  htmlOnly,
  inboxHeader,
  muted,
  nodes,
  notice,
  pageView,
  prose,
  rawText,
  textOnly,
  unsafeHtml,
} from "../factories.js";
import type { Node, PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export function inboxPageView(opts: {
  messages: InboxMessage[];
  message?: string;
  back?: PageBackLink;
}): PageView {
  const textLines: string[] = ["[Inbox]", ""];
  if (opts.back) {
    textLines.push(`${opts.back.label}  {base}/${opts.back.href.replace(/^\.\//, "")}`, "");
  }
  if (opts.message) textLines.push(opts.message, "");

  if (!opts.messages.length) {
    textLines.push("(empty)");
    return pageView(
      "Inbox",
      nodes(
        htmlOnly(
          ...nodes(
            backCrumb(opts.back),
            heading(1, "Inbox"),
            opts.message ? notice(opts.message, "flash") : undefined,
            muted(
              "Empty. Deal with messages as they arrive — this is not a mail archive.",
            ),
          ),
        ),
        textOnly(rawText(textLines)),
      ),
    );
  }

  const htmlArticles: Node[] = opts.messages.map((msg) => {
    textLines.push(`— ${msg.createdAt} from ${msg.fromUser}`);
    textLines.push(msg.subject);
    textLines.push(msg.body);
    if (msg.type === "exit_request") {
      textLines.push(`  Confirm: POST {base}/inbox/${msg.id}/confirm`);
    }
    if (msg.type === "invite_to_view") {
      textLines.push(`  View: GET {base}/s/${msg.sceneId}`);
    }
    textLines.push(`  Delete: POST {base}/inbox/${msg.id}/delete`);
    textLines.push("");

    const actionNodes: Node[] =
      msg.type === "exit_request"
        ? [
            form(
              { method: "post", action: `inbox/${msg.id}/confirm`, class: "inline" },
              button("Confirm"),
            ),
            form(
              { method: "post", action: `inbox/${msg.id}/delete`, class: "inline" },
              button("Delete", { class: "edit-danger" }),
            ),
          ]
        : [
            ...(msg.type === "invite_to_view"
              ? [unsafeHtml(`<a href="s/${msg.sceneId}">View scene</a>`)]
              : []),
            form(
              { method: "post", action: `inbox/${msg.id}/delete`, class: "inline" },
              button("Delete", { class: "edit-danger" }),
            ),
          ];

    return article(
      inboxHeader(msg.createdAt, msg.fromUser),
      heading(2, msg.subject, { class: "inbox-subject" }),
      prose(msg.body),
      box("inbox-actions", ...actionNodes),
    );
  });

  return pageView(
    "Inbox",
    nodes(
      htmlOnly(
        ...nodes(
          backCrumb(opts.back),
          heading(1, "Inbox"),
          opts.message ? notice(opts.message, "flash") : undefined,
          ...htmlArticles,
        ),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}
