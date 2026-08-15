import type { InboxMessage } from "../../../model/types.js";
import {
  article,
  box,
  button,
  detailsSection,
  field,
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
  error?: string;
  back?: PageBackLink;
  peerMessagingEnabled?: boolean;
  composeTo?: string;
  composeBody?: string;
}): PageView {
  const peerOn = opts.peerMessagingEnabled === true;
  const composeOpen = Boolean(opts.composeTo || opts.error || opts.composeBody);
  const textLines: string[] = ["[Messages]", ""];
  if (opts.back) {
    textLines.push(`${opts.back.label}  {base}/${opts.back.href.replace(/^\.\//, "")}`, "");
  }
  if (opts.error) textLines.push(opts.error, "");
  else if (opts.message) textLines.push(opts.message, "");

  if (peerOn) {
    textLines.push(
      "Compose:",
      "POST {base}/inbox/send",
      "  uid: username",
      "  body: message text (max 2000)",
      "",
    );
  }

  textLines.push("Inbox:");
  if (!opts.messages.length) {
    textLines.push("(empty)");
  } else {
    for (const msg of opts.messages) {
      textLines.push(`— ${msg.createdAt} from ${msg.fromUser}`);
      textLines.push(msg.subject);
      textLines.push(msg.body);
      if (msg.type === "exit_request") {
        textLines.push(`  Confirm: POST {base}/inbox/${msg.id}/confirm`);
      }
      if (msg.type === "invite_to_view") {
        textLines.push(`  View: GET {base}/s/${msg.sceneId}`);
      }
      if (peerOn && msg.type === "message") {
        textLines.push(`  Reply: GET {base}/inbox?to=${encodeURIComponent(msg.fromUser)}`);
      }
      textLines.push(`  Delete: POST {base}/inbox/${msg.id}/delete`);
      textLines.push("");
    }
  }

  const flash = opts.error
    ? notice(opts.error, "error")
    : opts.message
      ? notice(opts.message, "flash")
      : undefined;

  const composeNodes: Node[] = peerOn
    ? [
        detailsSection(
          "Compose",
          [
            muted(
              "Send a free-text note to one reader. Line breaks and prose adornments are kept: _emphasis_, *bold*, ~strike~, ---, and [links](https://…).",
            ),
            form(
              {
                method: "post",
                action: "inbox/send",
                class: "profile-form profile-appearance",
                id: "compose-form",
              },
              field("To", {
                type: "text",
                name: "uid",
                value: opts.composeTo ?? "",
                required: true,
                autocomplete: "off",
                placeholder: "uid",
              }),
              field("Message", {
                type: "textarea",
                name: "body",
                value: opts.composeBody ?? "",
                rows: 8,
                required: true,
                editor: "prose",
              }),
              button("Send"),
            ),
          ],
          { open: composeOpen, class: "messages-compose" },
        ),
      ]
    : [];

  const htmlArticles: Node[] = opts.messages.map((msg) => {
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
            ...(peerOn && msg.type === "message"
              ? [
                  unsafeHtml(
                    `<a href="inbox?to=${encodeURIComponent(msg.fromUser)}">Reply</a>`,
                  ),
                ]
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

  const listNodes: Node[] = opts.messages.length
    ? htmlArticles
    : [
        muted(
          peerOn
            ? "No messages yet. Deal with them as they arrive — this is not a mail archive."
            : "Empty. Deal with messages as they arrive — this is not a mail archive.",
        ),
      ];

  return pageView(
    "Messages",
    nodes(
      htmlOnly(
        ...nodes(
          backCrumb(opts.back),
          heading(1, "Messages"),
          flash,
          ...composeNodes,
          heading(2, "Inbox"),
          ...listNodes,
        ),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}
