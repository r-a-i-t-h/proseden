/** Title for a user's permanent home scene. */
export function userHomeSceneTitle(username: string): string {
  return `${username} home`;
}

/** Default body for a user's permanent home scene (assigned at registration). */
export function userHomeSceneBody(_username: string): string {
  return `This is your home scene — a private place for artefacts ejected from other scenes or orphaned when a scene is deleted.

Keep it private and do not link it into the world with exits unless you are sure. You cannot change which scene is your home; this one was assigned when you registered. If you make it too open, you cannot swap to a fresh private home.

You may edit this scene and its contents freely. It cannot be deleted.`;
}
