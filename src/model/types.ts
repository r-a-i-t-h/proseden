export type Visibility = "public" | "private";

export interface InventoryItem {
  artefactId: number;
  tags: string[];
}

export interface UserRecord {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  inventory: InventoryItem[];
  /** Reserved for later user-level grants */
  grants?: string[];
  denies?: string[];
}

export interface NodeMeta {
  id: number;
  owner: string;
  visibility: Visibility;
  title?: string;
  createdAt: string;
  modifiedAt: string[];
  /** Reserved — unused in v1 UI */
  groupId?: string | null;
  invites?: string[];
  denies?: string[];
  entranceGroupId?: string | null;
}

export interface NodeRecord extends NodeMeta {
  body: string;
  details: Record<string, string>;
}

export interface ExitRecord {
  exitId: number;
  nickname: string;
  toNodeId: number;
  createdAt: string;
}

export interface ArtefactMeta {
  id: number;
  owner: string;
  homeNodeId: number;
  title?: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string[];
}

export interface ArtefactRecord extends ArtefactMeta {
  body: string;
  details: Record<string, string>;
}

export interface MetaFile {
  nextNodeId: number;
  nextArtefactId: number;
}

export interface SessionRecord {
  token: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}
