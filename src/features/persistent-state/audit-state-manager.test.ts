import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditStateManager } from "./audit-state-manager";

const STATE_DIR = ".opencode";
const STATE_FILE = "argus-state.json";

describe("createAuditStateManager", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-state-manager-"));
    tempDirs.push(dir);
    return dir;
  }

  test("saves and loads state round-trip", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);

    await manager.update({
      currentPhase: "testing",
      contractsReviewed: ["Vault.sol"],
      scope: ["Vault.sol"],
    });

    const updatedState = manager.get();
    expect(updatedState).not.toBeNull();

    await manager.save(updatedState!);

    const loadedManager = createAuditStateManager(projectDir);
    const loaded = await loadedManager.load();

    expect(loaded).not.toBeNull();
    expect(loaded?.projectDir).toBe(projectDir);
    expect(loaded?.currentPhase).toBe("testing");
    expect(loaded?.contractsReviewed).toEqual(["Vault.sol"]);
    expect(loaded?.scope).toEqual(["Vault.sol"]);
  });

  test("uses atomic writes and leaves no tmp file", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);

    const state = manager.get();
    expect(state).not.toBeNull();

    await manager.save(state!);

    const statePath = join(projectDir, STATE_DIR, STATE_FILE);
    const tmpPath = `${statePath}.tmp`;

    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(tmpPath)).toBe(false);
  });

  test("returns null when loading missing state file", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);

    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("returns null when loading invalid state file", async () => {
    const projectDir = makeTempDir();
    const stateDir = join(projectDir, STATE_DIR);
    const statePath = join(stateDir, STATE_FILE);

    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, "not-json");

    const manager = createAuditStateManager(projectDir);
    const loaded = await manager.load();

    expect(loaded).toBeNull();
  });

  test("update merges partial state changes", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);
    const before = manager.get();

    expect(before).not.toBeNull();

    await manager.update({ currentPhase: "research" });

    const after = manager.get();
    expect(after).not.toBeNull();
    expect(after?.currentPhase).toBe("research");
    expect(after?.sessionId).toBe(before?.sessionId);
    expect(after?.projectDir).toBe(projectDir);
  });

  test("reset creates a fresh audit state", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);

    await manager.update({
      currentPhase: "reporting",
      contractsReviewed: ["Token.sol"],
    });

    const beforeReset = manager.get();
    expect(beforeReset).not.toBeNull();

    await manager.reset();
    const afterReset = manager.get();

    expect(afterReset).not.toBeNull();
    expect(afterReset?.currentPhase).toBe("reconnaissance");
    expect(afterReset?.contractsReviewed).toEqual([]);
    expect(afterReset?.sessionId).not.toBe(beforeReset?.sessionId);
  });

  test("save writes persistent metadata fields", async () => {
    const projectDir = makeTempDir();
    const manager = createAuditStateManager(projectDir);
    const state = manager.get();

    expect(state).not.toBeNull();
    await manager.save(state!);

    const statePath = join(projectDir, STATE_DIR, STATE_FILE);
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(typeof parsed.savedAt).toBe("number");
    expect(parsed.version).toBe("1");
    expect(parsed.filePath).toBe(statePath);
  });
});
