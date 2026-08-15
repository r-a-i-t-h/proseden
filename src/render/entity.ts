import type { EntityKind } from "../model/types.js";

export function entityKindLabel(kind: EntityKind): string {
  return kind === "scene" ? "Scene" : "Artefact";
}

export function entityPath(kind: EntityKind, id: number): string {
  return `${kind === "scene" ? "s" : "a"}/${id}`;
}

export function entityPathPrefix(kind: EntityKind): string {
  return kind === "scene" ? "s" : "a";
}

export function entityDisplayTitle(kind: EntityKind, id: number, title?: string): string {
  return title?.trim() ? title : `${entityKindLabel(kind)} ${id}`;
}

export function userPath(username: string): string {
  return `u/${encodeURIComponent(username)}`;
}
