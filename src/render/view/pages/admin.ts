import type { BackupInfo } from "../../../store/backup.js";
import {
  button,
  crumb,
  form,
  heading,
  linkList,
  muted,
  nodes,
  notice,
  pageView,
  para,
  rawText,
  table,
  textOnly,
} from "../factories.js";
import type { Node, PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function adminDataPageView(opts: {
  endpoints: Array<{ method: string; path: string; description: string }>;
  backups: BackupInfo[];
  notice?: string;
  back?: PageBackLink;
}): PageView {
  const backupRows = opts.backups.map((b) => {
    const href = `data/backup/${encodeURIComponent(b.name)}`;
    const restoreConfirm =
      "Replace all data with this archive? A safety backup of the current data will be created first.";
    return {
      cells: [
        { type: "para" as const, text: b.name },
        { type: "para" as const, text: formatBytes(b.size) },
        { type: "para" as const, text: b.mtime },
        {
          type: "fragment" as const,
          children: [
            { type: "userLink" as const, username: "" },
            {
              type: "unsafeHtml" as const,
              html: `<a href="${href}">Download</a>`,
            },
            {
              type: "unsafeHtml" as const,
              html: `<form method="post" action="${href}/restore" class="inline" onsubmit="return confirm('${restoreConfirm}');"><button type="submit">Restore</button></form>`,
            },
            form(
              { method: "post", action: `${href}/delete`, class: "inline" },
              button("Delete"),
            ),
          ].filter((n) => n.type !== "userLink"),
        },
      ] as Node[],
    };
  });

  const textLines = [
    ...opts.endpoints.map((e) => `${e.method} ${e.path} — ${e.description}`),
    "",
    "Backups:",
    ...(opts.backups.length
      ? opts.backups.map((b) => `  ${b.name}  ${formatBytes(b.size)}  ${b.mtime}`)
      : ["  (none)"]),
  ];

  return pageView(
    "Data",
    nodes(
      backCrumb(opts.back),
      heading(1, "Data"),
      opts.notice ? notice(opts.notice) : undefined,
      muted("Quests · Alchemy recipes"),
      {
        type: "para",
        text: "",
        class: "muted",
      },
      {
        type: "unsafeHtml",
        html: `<p class="muted"><a href="data/quests">Quests</a> · <a href="data/alchemy">Alchemy recipes</a></p>`,
      },
      linkList(
        opts.endpoints.map((e) => ({
          href: e.path.replace(/^\//, ""),
          label: `${e.method} ${e.path}`,
          note: e.description,
        })),
      ),
      heading(2, "Data backups"),
      muted("Archives data/ only (not the app). Restore replaces all data; a safety backup is created first."),
      form({ method: "post", action: "data/backup", class: "stack" }, button("Backup now")),
      table(["File", "Size", "Modified", ""], backupRows, {
        class: "backup-table",
        empty: "No archives yet.",
      }),
      heading(2, "World cache"),
      form(
        { method: "post", action: "data/reload", class: "stack" },
        button("Reload world from disk"),
      ),
      textOnly(rawText(textLines)),
    ),
  );
}

export function adminQuestsIndexPageView(opts: {
  names: string[];
  notice?: string;
  back?: PageBackLink;
}): PageView {
  return pageView(
    "Quests",
    nodes(
      backCrumb(opts.back),
      heading(1, "Quests"),
      muted(
        "Manager quest files in quests/<name>.json. Evaluated before questor personal files (user.<username>.*). Name user is reserved.",
      ),
      opts.notice ? notice(opts.notice) : undefined,
      opts.names.length
        ? linkList(
            opts.names.map((name) => ({
              href: `data/quests/${encodeURIComponent(name)}`,
              label: name,
            })),
          )
        : para("No quests yet.", "muted"),
      heading(2, "New quest"),
      form(
        { method: "post", action: "data/quests", class: "stack" },
        {
          type: "field",
          label: "Name",
          control: { type: "text", name: "name", required: true },
        },
        button("Create"),
      ),
      crumb("data", "← Data"),
      textOnly(rawText([opts.names.join("\n") || "(none)"])),
    ),
  );
}
