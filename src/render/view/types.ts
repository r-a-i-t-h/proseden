/** Proseden document vocabulary — structure for dual HTML/text serialization. */

export type Channel = "html" | "text" | "both";

export type EditorKind = "plain" | "prose" | "json";

export type MetaPart =
  | string
  | { type: "relativeAge"; iso: string }
  | { type: "labeledAge"; label: string; iso: string }
  | { type: "userLink"; username: string };

export type LinkListItem = {
  href: string;
  label: string;
  /** Trailing muted note (plain text; escaped in HTML). */
  note?: string;
  /** Trailing muted HTML (trusted; for composed fragments like user links). */
  noteHtml?: string;
  /** Extra path shown in text mode after the label (defaults to href with base). */
  textHref?: string;
  /** Optional id prefix in text lists (e.g. artefact id). */
  textId?: string | number;
};

export type StatListItem = {
  label: string;
  value: string | number;
  /** Optional drill-down; label is linked when set. */
  href?: string;
};

export type Control =
  | {
      type: "text";
      name: string;
      value?: string;
      required?: boolean;
      min?: string;
      autocomplete?: string;
      placeholder?: string;
      inputMode?: string;
      maxlength?: number;
    }
  | {
      type: "number";
      name: string;
      value?: string;
      required?: boolean;
      min?: string;
    }
  | {
      type: "password";
      name: string;
      required?: boolean;
      minlength?: number;
      autocomplete?: string;
    }
  | {
      type: "checkbox";
      name: string;
      value?: string;
      checked?: boolean;
      label: string;
      class?: string;
    }
  | {
      type: "hidden";
      name: string;
      value: string;
    }
  | {
      type: "select";
      name: string;
      required?: boolean;
      options: Array<{ value: string; label: string; selected?: boolean; disabled?: boolean }>;
    }
  | {
      type: "textarea";
      name: string;
      value: string;
      rows?: number;
      required?: boolean;
      /** Marker for optional client upgrade — ignored by text renderer. */
      editor?: EditorKind;
      /** When editor is json: pretty value comes from formatJsonTextarea(jsonValue). */
      jsonValue?: unknown;
      jsonExample?: string;
      jsonHelp?: string;
    }
  | {
      type: "button";
      label: string;
      class?: string;
      buttonType?: "submit" | "button";
    };

export type Node =
  | { type: "fragment"; channel?: Channel; children: Node[] }
  | { type: "heading"; level: 1 | 2 | 3; text: string; sub?: string; detailSub?: string; class?: string }
  | {
      type: "entityTitle";
      kind: "scene" | "artefact";
      id: number;
      title?: string;
      detail?: string;
    }
  | { type: "crumb"; href: string; label: string; history?: boolean }
  | { type: "byline"; username: string }
  | { type: "prose"; text: string }
  | { type: "muted"; parts: MetaPart[] }
  | { type: "notice"; text: string; kind?: "status" | "error" | "flash" }
  | { type: "para"; text: string; class?: string }
  | { type: "meta"; parts: MetaPart[] }
  | { type: "linkList"; items: LinkListItem[] }
  | { type: "statList"; items: StatListItem[] }
  | { type: "section"; title: string; children: Node[]; channel?: Channel }
  | {
      type: "details";
      summary: string;
      open?: boolean;
      class?: string;
      attrs?: Record<string, string>;
      children: Node[];
    }
  | { type: "userLink"; username: string }
  | {
      type: "form";
      method?: string;
      action: string;
      class?: string;
      id?: string;
      children: Node[];
      /** Text-mode recipe lines (emitted instead of / in addition for text). */
      textRecipes?: string[];
    }
  | { type: "field"; label: string; control: Control; class?: string }
  | {
      type: "jsonField";
      label: string;
      name: string;
      rows?: number;
      value: unknown;
      example: string;
      note: string;
      /** When set, use this source text instead of pretty-printing `value`. */
      text?: string;
    }
  | {
      type: "table";
      class?: string;
      headers: string[];
      rows: Array<{ cells: Node[]; class?: string }>;
      empty?: string;
    }
  | { type: "button"; label: string; class?: string; buttonType?: "submit" | "button" }
  | { type: "pre"; text: string; class?: string }
  | { type: "rawText"; lines: string[]; channel?: Channel }
  | {
      type: "actionRecipes";
      /** Use `{base}` for assetBase prefix (empty string when none). */
      recipes: string[];
    }
  | { type: "script"; source: string }
  | { type: "unsafeHtml"; html: string }
  | {
      type: "article";
      class?: string;
      children: Node[];
    }
  | {
      type: "box";
      class?: string;
      children: Node[];
    }
  | {
      type: "inboxHeader";
      createdAt: string;
      fromUser: string;
    };

export type PageView = {
  title: string;
  body: Node[];
};

export type TextRenderOptions = {
  basePath?: string;
};

export function isPageView(value: unknown): value is PageView {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    "body" in value &&
    Array.isArray((value as PageView).body)
  );
}
