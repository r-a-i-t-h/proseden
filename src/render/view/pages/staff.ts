import {
  button,
  field,
  form,
  heading,
  linkList,
  nodes,
  pageView,
  para,
  rawText,
  script,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

const STAFF_SCRIPT = `(function () {
          var form = document.getElementById("staff-form");
          if (!form) return;
          form.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var username = form.querySelector('input[name="username"]').value.trim();
            var roles = form.querySelector('input[name="roles"]').value;
            if (!username) return;
            form.action = "staff/" + encodeURIComponent(username);
            var body = new URLSearchParams();
            body.set("roles", roles);
            fetch(form.action, {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
              body: body,
            }).then(function (r) {
              if (r.ok) window.location.reload();
              else r.json().then(function (err) { alert(err.error || "Failed"); });
            });
          });
        })();`;

export function staffPageView(opts: {
  roles: Record<string, string[]>;
  back?: PageBackLink;
}): PageView {
  const entries = Object.entries(opts.roles).sort(([a], [b]) => a.localeCompare(b));
  return pageView(
    "Staff",
    nodes(
      backCrumb(opts.back),
      heading(1, "Staff"),
      entries.length
        ? linkList(
            entries.map(([username, roles]) => ({
              href: `u/${encodeURIComponent(username)}`,
              label: username,
              note: roles.join(", ") || "(none)",
            })),
          )
        : para("No staff roles assigned.", "muted"),
      heading(2, "Assign staff role"),
      form(
        { method: "post", action: "staff/", class: "stack", id: "staff-form" },
        field("Username", { type: "text", name: "username", required: true }),
        field("Roles (comma: moderator, topographer, manager, questor)", {
          type: "text",
          name: "roles",
          placeholder: "questor",
        }),
        button("Save roles"),
      ),
      script(STAFF_SCRIPT),
      textOnly(rawText([JSON.stringify(opts.roles, null, 2)])),
    ),
  );
}
