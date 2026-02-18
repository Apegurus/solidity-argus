import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditStateManager } from "../../managers/types";
import { createAuditState } from "../../state/audit-state";
import type { AuditState, PersistentAuditState } from "../../state/types";
import { createLogger } from "../../shared/logger";

const STATE_FILE_DIR = ".opencode";
const STATE_FILE_NAME = "argus-state.json";
const STATE_VERSION = "1";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAuditState(value: unknown): value is AuditState {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.sessionId === "string" &&
    typeof value.projectDir === "string" &&
    isStringArray(value.contractsReviewed) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.toolsExecuted) &&
    typeof value.currentPhase === "string" &&
    isStringArray(value.scope) &&
    typeof value.startTime === "number"
  );
}

function isPersistentAuditState(value: unknown): value is PersistentAuditState {
  if (!isAuditState(value) || !isObject(value)) {
    return false;
  }

  return (
    typeof value.savedAt === "number" &&
    typeof value.version === "string" &&
    typeof value.filePath === "string"
  );
}

export function createAuditStateManager(projectDir: string): AuditStateManager {
  const logger = createLogger();
  const stateFilePath = join(projectDir, STATE_FILE_DIR, STATE_FILE_NAME);
  let currentState: AuditState = createAuditState(projectDir).state;

  async function load(): Promise<AuditState | null> {
    try {
      const file = Bun.file(stateFilePath);
      if (!(await file.exists())) {
        return null;
      }

      const content = await file.text();
      if (!content.trim()) {
        return null;
      }

      const parsed: unknown = JSON.parse(content);
      if (!isPersistentAuditState(parsed)) {
        logger.warn("Persistent audit state is invalid, ignoring", stateFilePath);
        return null;
      }

      const { savedAt: _savedAt, version: _version, filePath: _filePath, ...state } = parsed;
      currentState = state;
      return currentState;
    } catch (_error) {
      return null;
    }
  }

  async function save(state: AuditState): Promise<void> {
    currentState = state;

    const persistentState: PersistentAuditState = {
      ...state,
      savedAt: Date.now(),
      version: STATE_VERSION,
      filePath: stateFilePath,
    };

    const tempFilePath = `${stateFilePath}.tmp`;
    await mkdir(dirname(stateFilePath), { recursive: true });
    await Bun.write(tempFilePath, `${JSON.stringify(persistentState, null, 2)}\n`);
    await rename(tempFilePath, stateFilePath);
  }

  function get(): AuditState {
    return currentState;
  }

  async function update(patch: Partial<AuditState>): Promise<void> {
    currentState = {
      ...currentState,
      ...patch,
    };

    await save(currentState);
  }

  async function reset(): Promise<void> {
    currentState = createAuditState(projectDir).state;
    await save(currentState);
  }

  return {
    load,
    save,
    get,
    update,
    reset,
  };
}
