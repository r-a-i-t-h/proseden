import type {
  ArtefactRecord,
  GroupRecord,
  SceneRecord,
  StaffRole,
  UserRecord,
} from "../../src/model/types.js";
import type { AccessWorld } from "../../src/access/permissions.js";

export function user(
  username: string,
  patch: Partial<UserRecord> = {},
): UserRecord {
  return {
    username,
    passwordHash: "hash",
    passwordSalt: "salt",
    createdAt: "2020-01-01T00:00:00.000Z",
    inventory: [],
    description: "",
    details: {},
    ...patch,
  };
}

export function scene(
  id: number,
  owner: string,
  patch: Partial<SceneRecord> = {},
): SceneRecord {
  return {
    id,
    owner,
    visibility: "private",
    createdAt: "2020-01-01T00:00:00.000Z",
    modifiedAt: [],
    body: "body",
    details: {},
    grants: [],
    denies: [],
    ...patch,
  };
}

export function artefact(
  id: number,
  owner: string,
  homeSceneId: number,
  patch: Partial<ArtefactRecord> = {},
): ArtefactRecord {
  return {
    id,
    owner,
    homeSceneId,
    tags: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    modifiedAt: [],
    body: "artefact",
    details: {},
    ...patch,
  };
}

export function group(
  id: string,
  owner: string,
  patch: Partial<GroupRecord> = {},
): GroupRecord {
  return {
    id,
    owner,
    title: `Group ${id}`,
    sceneIds: [],
    grants: [],
    denies: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    ...patch,
  };
}

export function world(opts: {
  users?: UserRecord[];
  scenes?: SceneRecord[];
  groups?: GroupRecord[];
  roles?: Record<string, StaffRole[]>;
}): AccessWorld {
  const users = new Map((opts.users ?? []).map((u) => [u.username, u]));
  const scenes = new Map((opts.scenes ?? []).map((s) => [s.id, s]));
  const groups = new Map((opts.groups ?? []).map((g) => [g.id, g]));
  const roles = opts.roles ?? {};
  return {
    getUser: (username) => users.get(username),
    getScene: (id) => scenes.get(id),
    getGroup: (id) => groups.get(id),
    getEntranceGroup: () => undefined,
    rolesFor: (username) => roles[username] ?? [],
  };
}
