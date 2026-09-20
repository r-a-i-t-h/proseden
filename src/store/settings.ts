import type { SettingsFile } from "../model/types.js";
import type { WorldStore } from "./world.js";

export type SettingKey = keyof SettingsFile;

/** Dispatch a boolean settings.json toggle through the existing WorldStore setters. */
export async function updateSetting(
  world: WorldStore,
  key: SettingKey,
  enabled: boolean,
): Promise<SettingsFile> {
  switch (key) {
    case "peerMessagingEnabled":
      return world.setPeerMessagingEnabled(enabled);
    case "guestLiveEnabled":
      return world.setGuestLiveEnabled(enabled);
    case "liveChatEnabled":
      return world.setLiveChatEnabled(enabled);
    case "registrationEnabled":
      return world.setRegistrationEnabled(enabled);
    case "nonManagerEditingEnabled":
      return world.setNonManagerEditingEnabled(enabled);
    case "nonManagerViewEnabled":
      return world.setNonManagerViewEnabled(enabled);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}
