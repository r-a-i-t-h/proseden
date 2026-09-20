import type { PageBackLink } from "./profile.js";
import { backCrumb } from "./profile.js";
import {
  button,
  crumb,
  form,
  heading,
  jsonField,
  muted,
  nodes,
  notice,
  pageView,
  rawText,
  textOnly,
} from "../factories.js";
import type { Node, PageView } from "../types.js";

export function jsonFileEditorPageView(opts: {
  title: string;
  heading: string;
  intro?: string;
  notice?: string;
  action: string;
  fieldLabel: string;
  fieldName: string;
  value: unknown;
  example: string;
  note: string;
  rawText?: string;
  rows?: number;
  back?: PageBackLink;
  extra?: Node[];
  textBody?: string;
}): PageView {
  return pageView(
    opts.title,
    nodes(
      backCrumb(opts.back),
      heading(1, opts.heading),
      opts.intro ? muted(opts.intro) : undefined,
      opts.notice ? notice(opts.notice) : undefined,
      form(
        { method: "post", action: opts.action, class: "stack" },
        jsonField(
          opts.fieldLabel,
          opts.fieldName,
          opts.value,
          opts.example,
          opts.note,
          opts.rows ?? 24,
          opts.rawText,
        ),
        button("Save"),
      ),
      ...(opts.extra ?? []),
      textOnly(rawText([opts.textBody ?? JSON.stringify(opts.value, null, 2)])),
    ),
  );
}

export function editorBackCrumb(href: string, label: string): Node {
  return crumb(href, label);
}
