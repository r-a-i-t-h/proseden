import type { WorldOverviewCounts } from "../../../store/world.js";
import {
  heading,
  linkList,
  muted,
  nodes,
  pageView,
  section,
  statList,
} from "../factories.js";
import type { PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export type DashboardOverviewCounts = WorldOverviewCounts;

export function dashboardPageView(opts: {
  counts: WorldOverviewCounts;
  online: number;
  back?: PageBackLink;
}): PageView {
  const { counts, online } = opts;
  return pageView(
    "Dashboard",
    nodes(
      backCrumb(opts.back),
      heading(1, "Dashboard"),
      muted("In-memory counts of the loaded world."),
      section("People", [
        statList([
          { label: "Users", value: counts.users },
          { label: "Online", value: online, href: "live/admin" },
          { label: "Staff", value: counts.staff, href: "staff" },
        ]),
      ]),
      section("Places", [
        statList([
          { label: "Scenes", value: counts.scenes },
          { label: "Exits", value: counts.exits },
          { label: "Artefacts", value: counts.artefacts },
          { label: "Groups", value: counts.groups },
          { label: "Entrance groups", value: counts.entranceGroups },
        ]),
      ]),
      section("Logic", [
        statList([
          { label: "Quests", value: counts.quests, href: "data/quests" },
          { label: "Personal quest files", value: counts.userQuestFiles },
          { label: "Alchemy recipes", value: counts.alchemyRecipes, href: "data/alchemy" },
          { label: "Personal alchemy files", value: counts.userAlchemyFiles },
        ]),
      ]),
      section("Messages", [statList([{ label: "Inbox", value: counts.inbox }])]),
      section("Tools", [
        linkList([
          { href: "data", label: "Data", note: "backups, reload, quests, alchemy" },
          { href: "staff", label: "Staff", note: "roles" },
          { href: "msg", label: "Msg", note: "notices and peer messaging" },
          { href: "live/admin", label: "Live Admin", note: "presence and chat" },
        ]),
      ]),
    ),
  );
}
