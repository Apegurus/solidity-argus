import type { ArgusConfig } from "../config/types";
import type { Managers } from "../managers/types";

/**
 * PluginState interface
 * Represents the complete state of the Argus plugin instance
 * Includes configuration, project context, and manager instances
 */
export interface PluginState {
  config: ArgusConfig;
  projectDir: string;
  managers: Managers;
  isHookEnabled: (name: string) => boolean;
}
