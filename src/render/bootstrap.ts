import type { ArtefactRecord, ExitRecord, SceneRecord } from "../model/types.js";

export interface OwnedSceneLink {
  id: number;
  title?: string;
}

/** Capability flags and entity snapshots for the Edit panel. */
export interface ManageContext {
  kind: "scene" | "artefact" | "inventory" | "home";
  scene?: SceneRecord;
  artefact?: ArtefactRecord;
  exits?: Array<ExitRecord & { canRemove?: boolean }>;
  canEdit?: boolean;
  canManage?: boolean;
  /** Add exit from this scene (manage/topographer, or public junction). */
  canAddExit?: boolean;
  /** Place an artefact in this scene (edit, or public repository). */
  canPlaceArtefact?: boolean;
  /** Reorder the origin’s full exit list (manage or topographer). */
  canReorderExits?: boolean;
  /** Return a guest artefact to its owner's home scene. */
  canEject?: boolean;
  isTopographer?: boolean;
  canDelete?: boolean;
  /** Ownership transfer — owner or staff manager, not a manage grant. */
  canTransfer?: boolean;
  isManager?: boolean;
  collected?: boolean;
  groups?: Array<{ id: string; title: string }>;
  entranceGroups?: Array<{ id: string; title: string; entranceSceneId: number }>;
  sceneGroup?: { id: string; title: string };
}

/** JSON embedded in `#edit-bootstrap` for Live/Edit panels. */
export interface EditBootstrap {
  user?: { username: string };
  manage?: ManageContext;
  ownedScenes: OwnedSceneLink[];
  isManager: boolean;
  isModerator: boolean;
  isQuestor: boolean;
  editHref: string;
  readHref: string;
  /** Present on scene pages — enables Live panel + SSE. */
  liveSceneId?: number;
  /** Guests may open Live on public scenes. */
  allowGuestLive: boolean;
  /** Say and shout in Live. */
  liveChatEnabled: boolean;
  /** New account registration. */
  registrationEnabled: boolean;
  /** Non-managers may use Edit mode. */
  nonManagerEditingEnabled: boolean;
}
