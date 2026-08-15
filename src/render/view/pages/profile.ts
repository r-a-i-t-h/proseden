import { formatAccessSummary } from "../../../access/acl.js";
import type { Deny, Grant } from "../../../model/types.js";
import {
  DENIES_EXAMPLE,
  DETAILS_EXAMPLE,
  GRANTS_EXAMPLE,
} from "../examples.js";
import {
  button,
  byline,
  crumb,
  detailsSection,
  field,
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

export type PageBackLink = { href: string; label: string; history?: boolean };

function backCrumb(back?: PageBackLink): Node | undefined {
  if (!back) return undefined;
  return crumb(back.href, back.label, back.history);
}

function accessForm(
  action: string,
  grants: Grant[] | undefined,
  denies: Deny[] | undefined,
  submit: string,
): Node {
  return form(
    { method: "post", action, class: "access-form" },
    jsonField(
      "Grants",
      "grantsJson",
      grants ?? [],
      GRANTS_EXAMPLE,
      "Array of { who, rights }.",
    ),
    jsonField(
      "Denies",
      "deniesJson",
      denies ?? [],
      DENIES_EXAMPLE,
      "Array of { who, rights? }. Omit rights to deny all.",
    ),
    button(submit),
  );
}

export function profilePageView(opts: {
  username: string;
  message?: string;
  description?: string;
  details?: Record<string, string>;
  grants?: Grant[];
  denies?: Deny[];
  back?: PageBackLink;
  openSection?: "appearance" | "password" | "sharing";
  badges?: Array<{ id: string; title: string }>;
}): PageView {
  const open = opts.openSection ?? "appearance";
  const accessAction = `u/${encodeURIComponent(opts.username)}/access`;
  const badges = opts.badges ?? [];

  const detailNames = Object.keys(opts.details ?? {});
  const textLines: string[] = ["[Profile]", ""];
  if (opts.back) {
    textLines.push(`${opts.back.label}  {base}/${opts.back.href.replace(/^\.\//, "")}`, "");
  }
  textLines.push(`Signed in as ${opts.username}`, "");
  if (opts.message) {
    textLines.push(opts.message, "");
  }
  if (badges.length) {
    textLines.push("Badges:");
    for (const b of badges) textLines.push(`  - ${b.title} (${b.id})`);
    textLines.push("", "  POST {base}/profile/badges/:id/drop", "");
  }
  textLines.push("Appearance:");
  if (opts.description?.trim()) {
    textLines.push(opts.description, "");
  }
  if (detailNames.length) {
    textLines.push("Details:");
    for (const name of detailNames) textLines.push(`  - ${name}`);
    textLines.push("");
  }
  textLines.push(
    "  POST {base}/profile",
    "  description, detailsJson",
    "",
    "Password:",
    "  POST {base}/auth/password",
    "  currentPassword, newPassword, confirmPassword",
    "",
    "Sharing (every scene and group you own):",
    `  POST {base}/u/${opts.username}/access`,
    "  grantsJson, deniesJson",
    "",
    formatAccessSummary(opts.grants, opts.denies),
  );

  const badgeNodes =
    badges.length === 0
      ? [muted("No badges yet.")]
      : badges.map((b) =>
          form(
            {
              method: "post",
              action: `profile/badges/${encodeURIComponent(b.id)}/drop`,
              class: "badge-row",
            },
            muted(`${b.title} (${b.id})`),
            button("drop"),
          ),
        );

  return pageView(
    "Profile",
    nodes(
      htmlOnly(
        ...nodes(
          backCrumb(opts.back),
          heading(1, "Profile"),
          byline(opts.username),
          opts.message ? notice(opts.message) : undefined,
          detailsSection("Badges", badgeNodes, {
            open: true,
            class: "profile-section",
          }),
          detailsSection(
            "Appearance",
            [
              form(
                {
                  method: "post",
                  action: "profile",
                  class: "profile-form profile-appearance",
                },
                field("Description", {
                  type: "textarea",
                  name: "description",
                  value: opts.description ?? "",
                  rows: 8,
                  editor: "prose",
                }),
                jsonField(
                  "Details",
                  "detailsJson",
                  opts.details ?? {},
                  DETAILS_EXAMPLE,
                  "Object of named closer-look texts.",
                ),
                button("Save appearance"),
              ),
            ],
            { open: open === "appearance", class: "profile-section" },
          ),
          detailsSection(
            "Password",
            [
              form(
                { method: "post", action: "auth/password", class: "profile-form" },
                field("Current password", {
                  type: "password",
                  name: "currentPassword",
                  required: true,
                  autocomplete: "current-password",
                }),
                field("New password", {
                  type: "password",
                  name: "newPassword",
                  required: true,
                  minlength: 6,
                  autocomplete: "new-password",
                }),
                field("Confirm new password", {
                  type: "password",
                  name: "confirmPassword",
                  required: true,
                  minlength: 6,
                  autocomplete: "new-password",
                }),
                button("Update password"),
              ),
            ],
            { open: open === "password", class: "profile-section" },
          ),
          detailsSection(
            "Sharing",
            [
              muted("Applies to every scene and group you own."),
              accessForm(accessAction, opts.grants, opts.denies, "Save share-all"),
            ],
            { open: open === "sharing", class: "profile-section" },
          ),
        ),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}

export { accessForm, backCrumb };
