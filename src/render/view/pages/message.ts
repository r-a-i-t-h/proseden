import {
  button,
  detailsSection,
  field,
  form,
  heading,
  htmlOnly,
  muted,
  nodes,
  pageView,
  prose,
  rawText,
  textOnly,
} from "../factories.js";
import type { PageView } from "../types.js";

/** Generic title + prose page (errors, short notices). */
export function messagePageView(title: string, message: string): PageView {
  return pageView(title, nodes(heading(1, title), prose(message)));
}

export function viewLockdownPageView(): PageView {
  return pageView(
    "Closed",
    nodes(
      heading(1, "Proseden is closed"),
      muted("The site is temporarily closed to readers. Managers may log in below."),
      htmlOnly(
        detailsSection(
          "Log in",
          [
            form(
              { method: "post", action: "auth/login", class: "login-form" },
              field("User", { type: "text", name: "username", autocomplete: "username", required: true }),
              field("Pass", {
                type: "password",
                name: "password",
                autocomplete: "current-password",
                required: true,
              }),
              button("Log in"),
            ),
          ],
          { open: true, class: "login" },
        ),
      ),
      textOnly(
        rawText([
          "Proseden is closed.",
          "",
          "The site is temporarily closed to readers. Managers may log in.",
        ]),
      ),
    ),
  );
}
