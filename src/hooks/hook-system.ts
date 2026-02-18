import type { HookName } from "./types";

export function createHookGuard(disabledHooks: string[]) {
  const disabledSet = new Set(disabledHooks);

  return function isHookEnabled(name: HookName): boolean {
    return !disabledSet.has(name);
  };
}
