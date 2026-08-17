import { describe, expect, it } from "vitest";
import {
  canAddExit,
  canEdit,
  canEditArtefact,
  canEditGroup,
  canManage,
  canManageGroup,
  canTransferGroup,
  canTransferScene,
  canRead,
  canReadArtefact,
  canReadGroup,
  canRemoveExit,
  canReorderExits,
  hasRight,
  isManager,
  isModerator,
  isQuestor,
  isTopographer,
} from "../src/access/permissions.js";
import { artefact, group, scene, user, world } from "./helpers/fixtures.js";
import type { ExitRecord } from "../src/model/types.js";

const alice = user("alice");
const bob = user("bob");
const carol = user("carol");

describe("scene hasRight / canRead / canEdit / canManage", () => {
  it("allows anonymous read of public scenes only", () => {
    const pub = scene(1, "alice", { visibility: "public" });
    const priv = scene(2, "alice", { visibility: "private" });
    const w = world({ users: [alice] });

    expect(canRead(undefined, pub, w)).toBe(true);
    expect(canEdit(undefined, pub, w)).toBe(false);
    expect(canManage(undefined, pub, w)).toBe(false);
    expect(canRead(undefined, priv, w)).toBe(false);
  });

  it("gives the owner full access", () => {
    const s = scene(1, "alice");
    const w = world({ users: [alice] });
    expect(canRead(alice, s, w)).toBe(true);
    expect(canEdit(alice, s, w)).toBe(true);
    expect(canManage(alice, s, w)).toBe(true);
  });

  it("honours scene grants including hierarchy", () => {
    const s = scene(1, "alice", {
      grants: [{ who: "bob", rights: ["edit"] }],
    });
    const w = world({ users: [alice, bob] });
    expect(canRead(bob, s, w)).toBe(true);
    expect(canEdit(bob, s, w)).toBe(true);
    expect(canManage(bob, s, w)).toBe(false);
  });

  it("honours wildcard grants for anonymous readers", () => {
    const s = scene(1, "alice", {
      visibility: "private",
      grants: [{ who: "*", rights: ["read"] }],
    });
    const w = world({ users: [alice] });
    expect(canRead(undefined, s, w)).toBe(true);
    expect(canEdit(undefined, s, w)).toBe(false);
  });

  it("honours group grants when the scene is in a group", () => {
    const g = group("10", "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const s = scene(1, "alice", { groupId: "10" });
    const w = world({ users: [alice, bob], groups: [g] });
    expect(canManage(bob, s, w)).toBe(true);
  });

  it("honours owner user-level share-all grants", () => {
    const owner = user("alice", {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    const s = scene(1, "alice");
    const w = world({ users: [owner, bob] });
    expect(canRead(bob, s, w)).toBe(true);
    expect(canEdit(bob, s, w)).toBe(false);
  });

  it("lets scene denies beat grants and public visibility for the denied right", () => {
    const s = scene(1, "alice", {
      visibility: "public",
      grants: [{ who: "bob", rights: ["manage"] }],
      denies: [{ who: "bob", rights: ["read"] }],
    });
    const w = world({ users: [alice, bob] });
    expect(canRead(bob, s, w)).toBe(false);
    // Deny is per-right (not hierarchical), so manage can still pass.
    expect(canManage(bob, s, w)).toBe(true);
  });

  it("lets deny-all beat grants and public visibility", () => {
    const s = scene(1, "alice", {
      visibility: "public",
      grants: [{ who: "bob", rights: ["manage"] }],
      denies: [{ who: "bob" }],
    });
    const w = world({ users: [alice, bob] });
    expect(canRead(bob, s, w)).toBe(false);
    expect(canManage(bob, s, w)).toBe(false);
  });

  it("lets group denies beat scene grants", () => {
    const g = group("10", "alice", {
      denies: [{ who: "bob" }],
    });
    const s = scene(1, "alice", {
      groupId: "10",
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const w = world({ users: [alice, bob], groups: [g] });
    expect(canRead(bob, s, w)).toBe(false);
  });

  it("lets owner user-level denies beat scene grants and staff", () => {
    const owner = user("alice", {
      denies: [{ who: "bob" }],
    });
    const s = scene(1, "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const w = world({
      users: [owner, bob],
      roles: { bob: ["manager"] },
    });
    expect(hasRight(bob, s, "read", w)).toBe(false);
    expect(canManage(bob, s, w)).toBe(false);
  });

  it("denies the owner when they are explicitly denied on the scene", () => {
    const s = scene(1, "alice", {
      denies: [{ who: "alice" }],
    });
    const w = world({ users: [alice] });
    expect(canRead(alice, s, w)).toBe(false);
  });
});

describe("staff roles on scenes", () => {
  const privateScene = scene(1, "alice");

  it("lets moderators edit but not manage", () => {
    const w = world({ users: [alice, bob], roles: { bob: ["moderator"] } });
    expect(canRead(bob, privateScene, w)).toBe(true);
    expect(canEdit(bob, privateScene, w)).toBe(true);
    expect(canManage(bob, privateScene, w)).toBe(false);
    expect(isModerator(bob, w)).toBe(true);
    expect(isManager(bob, w)).toBe(false);
    expect(isTopographer(bob, w)).toBe(false);
    expect(canReorderExits(bob, privateScene, w)).toBe(false);
  });

  it("lets topographers reshape exits but not edit prose or manage ACL", () => {
    const w = world({ users: [alice, bob], roles: { bob: ["topographer"] } });
    expect(canEdit(bob, privateScene, w)).toBe(false);
    expect(canManage(bob, privateScene, w)).toBe(false);
    expect(isTopographer(bob, w)).toBe(true);
    expect(canReorderExits(bob, privateScene, w)).toBe(true);
    expect(isModerator(bob, w)).toBe(false);
    expect(isManager(bob, w)).toBe(false);
  });

  it("lets managers manage and topograph", () => {
    const w = world({ users: [alice, bob], roles: { bob: ["manager"] } });
    expect(canManage(bob, privateScene, w)).toBe(true);
    expect(isTopographer(bob, w)).toBe(true);
    expect(isManager(bob, w)).toBe(true);
    expect(isModerator(bob, w)).toBe(true);
    expect(isQuestor(bob, w)).toBe(true);
  });

  it("lets questors edit personal quests but not manage scenes", () => {
    const w = world({ users: [alice, bob], roles: { bob: ["questor"] } });
    expect(canEdit(bob, privateScene, w)).toBe(false);
    expect(canManage(bob, privateScene, w)).toBe(false);
    expect(isQuestor(bob, w)).toBe(true);
    expect(isManager(bob, w)).toBe(false);
    expect(isModerator(bob, w)).toBe(false);
  });

  it("returns false for staff helpers without a user", () => {
    const w = world({});
    expect(isTopographer(undefined, w)).toBe(false);
    expect(isModerator(undefined, w)).toBe(false);
    expect(isManager(undefined, w)).toBe(false);
    expect(isQuestor(undefined, w)).toBe(false);
  });
});

describe("artefact ACL", () => {
  it("inherits read from the home scene", () => {
    const home = scene(1, "alice", { visibility: "public" });
    const art = artefact(1, "alice", 1);
    const w = world({ users: [alice] });
    expect(canReadArtefact(undefined, art, home, w)).toBe(true);
    expect(canEditArtefact(undefined, art, home, w)).toBe(false);
  });

  it("lets the artefact owner edit even without scene edit rights", () => {
    const home = scene(1, "alice");
    const art = artefact(1, "bob", 1);
    const w = world({ users: [alice, bob] });
    expect(canReadArtefact(bob, art, home, w)).toBe(false);
    expect(canEditArtefact(bob, art, home, w)).toBe(true);
  });

  it("lets users with scene edit rights edit artefacts there", () => {
    const home = scene(1, "alice", {
      grants: [{ who: "carol", rights: ["edit"] }],
    });
    const art = artefact(1, "alice", 1);
    const w = world({ users: [alice, carol] });
    expect(canEditArtefact(carol, art, home, w)).toBe(true);
  });
});

describe("group ACL", () => {
  it("gives the group owner full access", () => {
    const g = group("1", "alice");
    const w = world({ users: [alice] });
    expect(canReadGroup(alice, g, w)).toBe(true);
    expect(canEditGroup(alice, g, w)).toBe(true);
    expect(canManageGroup(alice, g, w)).toBe(true);
  });

  it("honours group grants and denies", () => {
    const g = group("1", "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
      denies: [{ who: "carol", rights: ["read"] }],
    });
    const w = world({ users: [alice, bob, carol] });
    expect(canManageGroup(bob, g, w)).toBe(true);
    expect(canReadGroup(carol, g, w)).toBe(false);
  });

  it("honours owner user-level grants and denies for groups", () => {
    const owner = user("alice", {
      grants: [{ who: "bob", rights: ["read"] }],
      denies: [{ who: "carol" }],
    });
    const g = group("1", "alice", {
      grants: [{ who: "carol", rights: ["manage"] }],
    });
    const w = world({ users: [owner, bob, carol] });
    expect(canReadGroup(bob, g, w)).toBe(true);
    expect(canManageGroup(carol, g, w)).toBe(false);
  });

  it("lets staff managers manage groups", () => {
    const g = group("1", "alice");
    const w = world({ users: [alice, bob], roles: { bob: ["manager"] } });
    expect(canManageGroup(bob, g, w)).toBe(true);
  });

  it("does not let anonymous users read private groups", () => {
    const g = group("1", "alice");
    const w = world({ users: [alice] });
    expect(canReadGroup(undefined, g, w)).toBe(false);
  });

  it("allows wildcard group grants for anonymous readers", () => {
    const g = group("1", "alice", {
      grants: [{ who: "*", rights: ["read"] }],
    });
    const w = world({ users: [alice] });
    expect(canReadGroup(undefined, g, w)).toBe(true);
  });
});

describe("junction exit add / remove", () => {
  const junction = scene(1, "alice", { visibility: "public", isJunction: true });
  const bobRoom = scene(2, "bob", { visibility: "public" });
  const carolRoom = scene(3, "carol", { visibility: "public" });
  const toBob: ExitRecord = {
    exitId: 1,
    nickname: "bob-wing",
    toSceneId: 2,
    createdAt: "2020-01-01T00:00:00.000Z",
  };
  const toCarol: ExitRecord = {
    exitId: 2,
    nickname: "carol-wing",
    toSceneId: 3,
    createdAt: "2020-01-01T00:00:00.000Z",
  };

  it("lets any signed-in user add exits from a public junction", () => {
    const w = world({
      users: [alice, bob, carol],
      scenes: [junction, bobRoom, carolRoom],
    });
    expect(canAddExit(bob, junction, w)).toBe(true);
    expect(canAddExit(carol, junction, w)).toBe(true);
    expect(canAddExit(undefined, junction, w)).toBe(false);
  });

  it("lets junction visitors remove only exits to their own scenes", () => {
    const w = world({
      users: [alice, bob, carol],
      scenes: [junction, bobRoom, carolRoom],
    });
    expect(canRemoveExit(bob, junction, toBob, w)).toBe(true);
    expect(canRemoveExit(bob, junction, toCarol, w)).toBe(false);
    expect(canRemoveExit(carol, junction, toCarol, w)).toBe(true);
    expect(canRemoveExit(carol, junction, toBob, w)).toBe(false);
  });

  it("lets the junction owner remove any exit", () => {
    const w = world({
      users: [alice, bob, carol],
      scenes: [junction, bobRoom, carolRoom],
    });
    expect(canRemoveExit(alice, junction, toBob, w)).toBe(true);
    expect(canRemoveExit(alice, junction, toCarol, w)).toBe(true);
  });

  it("lets owner, manage grantee, and topographer reorder, not junction visitors", () => {
    const managed = scene(4, "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const w = world({
      users: [alice, bob, carol],
      scenes: [junction, bobRoom, carolRoom, managed],
      roles: { carol: ["topographer"] },
    });
    expect(canReorderExits(alice, junction, w)).toBe(true);
    expect(canReorderExits(bob, managed, w)).toBe(true);
    expect(canReorderExits(carol, junction, w)).toBe(true);
    expect(canReorderExits(bob, junction, w)).toBe(false);
    expect(canReorderExits(undefined, junction, w)).toBe(false);
  });
});

describe("ownership transfer rights", () => {
  it("allows the owner and staff manager, not a manage grantee", () => {
    const s = scene(1, "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const w = world({
      users: [alice, bob, carol],
      roles: { carol: ["manager"] },
    });
    expect(canTransferScene(alice, s, w)).toBe(true);
    expect(canTransferScene(bob, s, w)).toBe(false);
    expect(canManage(bob, s, w)).toBe(true);
    expect(canTransferScene(carol, s, w)).toBe(true);
    expect(canTransferScene(undefined, s, w)).toBe(false);
  });

  it("allows the group owner and staff manager, not a manage grantee", () => {
    const g = group("1", "alice", {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const w = world({
      users: [alice, bob, carol],
      roles: { carol: ["manager"] },
    });
    expect(canTransferGroup(alice, g, w)).toBe(true);
    expect(canTransferGroup(bob, g, w)).toBe(false);
    expect(canManageGroup(bob, g, w)).toBe(true);
    expect(canTransferGroup(carol, g, w)).toBe(true);
  });
});
