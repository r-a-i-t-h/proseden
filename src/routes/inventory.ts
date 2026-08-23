import { Hono } from "hono";
import { isManager, isQuestor } from "../access/permissions.js";
import {
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireUser,
  respondMutation,
  sceneBackLink,
} from "../http.js";
import { displayJsonTextarea, prepareJsonTextarea } from "../json-textarea.js";
import { triggerQuestEval } from "../logic/trigger.js";
import { matchAlchemyRecipe, parseAlchemyRecipes, parseQuestFile, QuestValidationError } from "../logic/quests.js";
import {
  inventoryPageView,
  jsonFileEditorPageView,
  messagePageView,
} from "../render/view/index.js";
import { ALCHEMY_EXAMPLE, ALCHEMY_HELP, QUEST_EXAMPLE, QUEST_HELP } from "../render/view/examples.js";
import { alchemyFail } from "./helpers.js";

export const inventoryRoutes = new Hono();

inventoryRoutes.get("/inv", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Inventory", "Log in to view your inventory."));
  }

  const items = user.inventory
    .map((item) => world.getArtefact(item.artefactId))
    .filter((a): a is NonNullable<typeof a> => !!a);

  const alchemyNotice = c.req.query("alchemy");
  const alchemyError = c.req.query("alchemy-error");
  const back = sceneBackLink(user, world);
  return page(
    c,
    200,
    inventoryPageView(items, back, {
      alchemyOk: alchemyNotice ? decodeURIComponent(alchemyNotice) : undefined,
      alchemyError: alchemyError ? decodeURIComponent(alchemyError) : undefined,
    }),
    { kind: "inventory", isManager: isManager(user, world) },
  );
});

inventoryRoutes.get("/alchemy", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Alchemy", "Log in to edit your alchemy recipes."));
  }
  const recipes = world.getUserAlchemyRecipes(user.username);
  const back = sceneBackLink(user, world);
  const notice = c.req.query("saved") ? "Recipes saved." : "";
  const help = `${ALCHEMY_HELP} You may only give artefacts homed in scenes you own or manage. This file is yours alone — not shared via scene ACL.`;
  const raw = await world.readUserAlchemyText(user.username);
  return page(
    c,
    200,
    jsonFileEditorPageView({
      title: "Alchemy",
      heading: "Your alchemy",
      intro: `Recipes in alchemy/users/${user.username}.json. Combined after the manager master list.`,
      notice,
      action: "alchemy",
      fieldLabel: "Recipes",
      fieldName: "recipesJson",
      value: recipes,
      example: ALCHEMY_EXAMPLE,
      note: help,
      rawText: raw !== undefined ? displayJsonTextarea(raw) : undefined,
      back,
    }),
    { kind: "inventory", isManager: isManager(user, world) },
  );
});

inventoryRoutes.post("/alchemy", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const body = await readRequestBody(c);
  try {
    const prepared = prepareJsonTextarea(String(body.recipesJson ?? body.json ?? ""));
    const recipes = parseAlchemyRecipes(JSON.parse(prepared));
    await world.saveUserAlchemy(user.username, recipes, prepared);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Save failed");
  }
  return respondMutation(c, { json: { ok: true }, redirect: "/alchemy", flash: { saved: "1" } });
});

inventoryRoutes.get("/quests", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Quests", "Log in to edit your personal quests."));
  }
  if (!isQuestor(user, world)) {
    return apiError(c, 403, "Questor role required");
  }
  const quest = world.getUserQuest(user.username) ?? world.emptyUserQuest(user.username);
  const back = sceneBackLink(user, world);
  const notice = c.req.query("saved") ? "Quest saved." : "";
  const example = QUEST_EXAMPLE.replaceAll("YOUR_USERNAME", `user.${user.username}`);
  const help = `${QUEST_HELP} This file is yours alone — not shared via scene ACL.`;
  const raw = await world.readUserQuestText(user.username);
  return page(
    c,
    200,
    jsonFileEditorPageView({
      title: "Quests",
      heading: "Your quests",
      intro: `Personal file quests/users/${user.username}.json. Namespace is user.${user.username}.*. Evaluated after manager quests.`,
      notice,
      action: "quests",
      fieldLabel: "Quest JSON",
      fieldName: "questJson",
      value: quest,
      example,
      note: help,
      rawText: raw !== undefined ? displayJsonTextarea(raw) : undefined,
      rows: 28,
      back,
    }),
    { kind: "inventory", isManager: isManager(user, world) },
  );
});

inventoryRoutes.post("/quests", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  if (!isQuestor(user, world)) return apiError(c, 403, "Questor role required");
  const body = await readRequestBody(c);
  try {
    const prepared = prepareJsonTextarea(String(body.questJson ?? body.json ?? ""));
    const quest = parseQuestFile(JSON.parse(prepared));
    await world.saveUserQuest(user.username, quest, prepared);
  } catch (err) {
    const msg =
      err instanceof QuestValidationError || err instanceof SyntaxError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Save failed";
    return apiError(c, 400, msg);
  }
  return respondMutation(c, { json: { ok: true }, redirect: "/quests", flash: { saved: "1" } });
});

inventoryRoutes.post("/alchemy/combine", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const body = await readRequestBody(c);
  let ids: number[] = [];
  if (Array.isArray(body.artefactIds)) {
    ids = body.artefactIds.map(Number).filter(Number.isFinite);
  } else if (typeof body.artefactIds === "string") {
    ids = body.artefactIds
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
  } else if (body.ids !== undefined) {
    const raw = Array.isArray(body.ids) ? body.ids : String(body.ids).split(/[\s,]+/);
    ids = raw.map(Number).filter(Number.isFinite);
  }
  // HTML checkboxes: artefactId repeated
  if (!ids.length && body.artefactId !== undefined) {
    const raw = body.artefactId;
    ids = (Array.isArray(raw) ? raw : [raw]).map(Number).filter(Number.isFinite);
  }

  ids = [...new Set(ids)];
  if (ids.length < 2) {
    return alchemyFail(c, "Select at least two artefacts to combine.");
  }
  for (const id of ids) {
    if (!user.inventory.some((i) => i.artefactId === id)) {
      return alchemyFail(c, "All ingredients must be in your inventory.");
    }
  }

  const tags = new Map<number, readonly string[]>();
  for (const a of world.artefacts.values()) tags.set(a.id, a.tags);
  const recipe = matchAlchemyRecipe(
    world.alchemyRecipes,
    ids,
    tags,
    (r) => world.alchemyRecipeGrantsAllowed(r),
  );
  if (!recipe) {
    return alchemyFail(c, "Those artefacts do not combine.");
  }

  const gives = Array.isArray(recipe.gives) ? recipe.gives : [recipe.gives];
  let updated = user;
  const already = gives.every((gid) => updated.inventory.some((i) => i.artefactId === gid));
  if (already) {
    return alchemyFail(c, "You already hold the result.");
  }
  const newlyGained: number[] = [];
  for (const gid of gives) {
    if (!world.getArtefact(gid)) {
      return alchemyFail(c, `Result artefact ${gid} is missing from the world.`);
    }
    if (!updated.inventory.some((i) => i.artefactId === gid)) {
      updated = await world.collectArtefact(updated.username, gid);
      newlyGained.push(gid);
    }
  }
  c.set("user", updated);
  await triggerQuestEval(c, updated, updated.lastSceneId, {
    wake: newlyGained.length ? "gain" : "always",
    wakeGained: newlyGained.length ? newlyGained : undefined,
  });
  const ok = recipe.ok ?? "Something new settles into your keeping.";
  return respondMutation(c, {
    json: {
      ok: true,
      message: ok,
      recipeId: recipe.id,
      gives,
      inventory: c.get("user")!.inventory,
    },
    redirect: "/inv",
    flash: { alchemy: ok },
  });
});




