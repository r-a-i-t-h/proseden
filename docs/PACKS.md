# Adventure packs

Portable archives of **scenes, artefacts, manager quests, master alchemy, and
groups** — not full world backups. Author in a standalone Proseden install,
export, then import into a shared world.

Managers use **Data → Adventure packs** (`GET /data/pack/export`,
`POST /data/pack/import`).

## What is included

| In the pack | Out of the pack |
|---|---|
| Non-home `scenes/*.md` + exits | `users/` (accounts, flags, vars, badges, inventory) |
| Artefacts homed on those scenes | Inbox / messages |
| Manager `quests/*.json` (incl. quest `alchemy`) | Personal `quests/users/*` |
| Master `alchemy/recipes.json` when non-empty | User alchemy files |
| Groups / entrance groups that still have members | Home scenes |

`pack.json` records format version, counts, quest names, and optional title.

## ID remapping

Scene and artefact ids stay ordinary world integers. Portability is remap at
the pack boundary:

1. **Export** densifies remaining ids to `1..N` / `1..M` (closes deletion holes)
   and rewrites exits, `homeSceneId`, Preds, FlagRefs (`holds:N`), and alchemy.
2. **Import** offsets those dense ids onto the host’s `nextSceneId` /
   `nextArtefactId` (and group counters), then writes new files and reloads.

Quest **names** colliding with the host are auto-renamed (`cave` → `cave_2`);
flag/var/badge refs and catalogue ids in the pack are rewritten to the new
prefix. Pass `questRenames` / `autoRenameQuests: false` on the JSON import API
to control that.

Optional import `owner` reassigns scene/artefact/group owners (HTML import
defaults to the importing manager).

## Not in scope

Selective export from a busy multi-adventure world, importing user progress,
or replacing live numeric ids with UUIDs.
