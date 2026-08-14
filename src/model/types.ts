export type Visibility = "public" | "private";

/** Hierarchical: manage ⊃ edit ⊃ read */
export type Right = "read" | "edit" | "manage";

export type StaffRole = "moderator" | "organiser" | "manager";

export interface Grant {
  /** Username or `"*"` for everyone (still subject to deny). */
  who: string;
  rights: Right[];
}

export interface Deny {
  who: string;
  /** Omit or empty = deny all rights. */
  rights?: Right[];
}

export interface InventoryItem {
  artefactId: number;
}

export interface UserRecord {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  inventory: InventoryItem[];
  /** Profile prose. Missing on disk defaults to "". */
  description: string;
  /** Named closer-look texts. Missing on disk defaults to {}. */
  details: Record<string, string>;
  /** Share-all: grants on this user's scenes and groups. */
  grants?: Grant[];
  /** Persona-non-grata blocks on this user's content. */
  denies?: Deny[];
  /** Last successfully rendered scene (resume-on-login). */
  lastSceneId?: number;
  /** ISO timestamp of last location note / presence flush. */
  lastSeenAt?: string;
}

export interface SceneMeta {
  id: number;
  owner: string;
  visibility: Visibility;
  title?: string;
  createdAt: string;
  modifiedAt: string[];
  groupId?: string | null;
  grants?: Grant[];
  denies?: Deny[];
  entranceGroupId?: string | null;
  /** Public junction: any signed-in user may add exits originating from this scene. */
  isJunction?: boolean;
  /** @deprecated migrated to grants on load */
  invites?: string[];
}

export interface SceneRecord extends SceneMeta {
  body: string;
  details: Record<string, string>;
}

export interface ExitRecord {
  exitId: number;
  nickname: string;
  toSceneId: number;
  createdAt: string;
}

export interface ArtefactMeta {
  id: number;
  owner: string;
  homeSceneId: number;
  title?: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string[];
}

export interface ArtefactRecord extends ArtefactMeta {
  body: string;
  details: Record<string, string>;
}

export interface GroupRecord {
  id: string;
  owner: string;
  title: string;
  sceneIds: number[];
  grants: Grant[];
  denies: Deny[];
  createdAt: string;
}

export interface EntranceGroupRecord {
  id: string;
  title: string;
  entranceSceneId: number;
  sceneIds: number[];
}

export interface StaffFile {
  /** username → roles */
  roles: Record<string, StaffRole[]>;
}

export interface MetaFile {
  nextSceneId: number;
  nextArtefactId: number;
  nextGroupId?: number;
  nextEntranceGroupId?: number;
  nextInboxId?: number;
  /** Scene id served at `/` and `/s` (default 1). */
  entranceSceneId?: number;
  /** Written only by deploy/migrations. Missing means schema v0. */
  schemaVersion?: number;
}

/** Inbox is a short queue — no read/unread; delete to clear. */
export interface InboxMessageBase {
  id: number;
  toUser: string;
  fromUser: string;
  createdAt: string;
  subject: string;
  body: string;
}

/** Ask the origin scene's owner to add an outbound exit. */
export interface ExitRequestMessage extends InboxMessageBase {
  type: "exit_request";
  fromSceneId: number;
  toSceneId: number;
  nickname: string;
}

/** Plain notice (e.g. exit confirmed). */
export interface NoticeMessage extends InboxMessageBase {
  type: "notice";
}

export type InboxMessage = ExitRequestMessage | NoticeMessage;

export interface SessionRecord {
  token: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface EditLogEntry {
  at: string;
  by: string;
  fields: string[];
  retained?: boolean;
  versionId?: string;
}

/** Scene or artefact — shared by HTML/text entity page templates. */
export type EntityKind = "scene" | "artefact";

export const ALL_RIGHTS: Right[] = ["read", "edit", "manage"];

export const RIGHT_RANK: Record<Right, number> = {
  read: 1,
  edit: 2,
  manage: 3,
};
