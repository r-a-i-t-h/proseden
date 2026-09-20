import type { Deny, Grant } from "../../../model/types.js";
import { DENIES_EXAMPLE, GRANTS_EXAMPLE } from "../examples.js";
import { button, field, form, heading, jsonField, muted } from "../factories.js";
import type { Node } from "../types.js";

export function accessForm(
  action: string,
  grants: Grant[] | undefined,
  denies: Deny[] | undefined,
  submit: string,
): Node {
  return form(
    { method: "post", action, class: "access-form" },
    jsonField("Grants", "grantsJson", grants ?? [], GRANTS_EXAMPLE, "Array of { who, rights }."),
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

export function transferForm(
  action: string,
  owner: string,
  kind: "scene" | "group",
): Node {
  const what =
    kind === "group"
      ? "this group, its scenes, and artefacts you own that are homed in those scenes"
      : "this scene and artefacts you own that are homed here";
  return form(
    { method: "post", action, class: "profile-form" },
    heading(2, "Transfer ownership"),
    muted(`Owner is ${owner}. Transfer ${what} to another registered user.`),
    field("New owner", {
      type: "text",
      name: "to",
      required: true,
      autocomplete: "username",
    }),
    {
      type: "field",
      label: "",
      control: { type: "hidden", name: "keepAccess", value: "0" },
    },
    {
      type: "field",
      label: "",
      control: {
        type: "checkbox",
        name: "keepAccess",
        value: "1",
        checked: true,
        label: "Keep my access",
        class: "edit-check",
      },
    },
    button("Transfer"),
  );
}
