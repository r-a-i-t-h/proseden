import { Hono } from "hono";
import { artefactRoutes } from "./artefacts.js";
import { groupRoutes } from "./groups.js";
import { historyRoutes } from "./history.js";
import { inboxRoutes } from "./inbox.js";
import { inventoryRoutes } from "./inventory.js";
import { profileRoutes } from "./profile.js";
import { sceneRoutes } from "./scenes.js";
import { staffRoutes } from "./staff.js";

export const worldRoutes = new Hono();

worldRoutes.get("/", (c) => {
  const world = c.get("world");
  return c.redirect(`${c.get("assetBase")}/s/${world.worldEntranceSceneId()}`);
});
worldRoutes.get("/s", (c) => {
  const world = c.get("world");
  return c.redirect(`${c.get("assetBase")}/s/${world.worldEntranceSceneId()}`);
});

worldRoutes.route("/", sceneRoutes);
worldRoutes.route("/", artefactRoutes);
worldRoutes.route("/", groupRoutes);
worldRoutes.route("/", inboxRoutes);
worldRoutes.route("/", staffRoutes);
worldRoutes.route("/", historyRoutes);
worldRoutes.route("/", profileRoutes);
worldRoutes.route("/", inventoryRoutes);
