import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ScvdClient, type ScvdFinding } from "./scvd-client";
import { getSyncStatus, syncAll, syncIncremental } from "./scvd-sync";

const tempDir = "/tmp/argus-scvd-sync-tests";

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createFinding(id: string): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title: `Title ${id}`,
    description_md: "Description text",
    severity: "High",
    taxonomy: { swc: ["SWC-107"], cwe: ["CWE-841"] },
    repo: { url: "https://github.com/example/repo" },
    sections: {},
  };
}

function createMockClient(): ScvdClient {
  return new ScvdClient("https://api.scvd.dev");
}

describe("syncAll", () => {
  test("syncs all findings and writes index", async () => {
    mkdirSync(tempDir, { recursive: true });
    const indexPath = join(tempDir, "scvd-index.json");
    const client = createMockClient();

    client.fetchAllFindings = async () => [createFinding("SCVD-1"), createFinding("SCVD-2")];

    const result = await syncAll(client, indexPath);

    expect(result.success).toBe(true);
    expect(result.newFindings).toBe(2);
    expect(result.totalIndexed).toBe(2);
    expect(result.lastSync.length).toBeGreaterThan(0);

    const fileExists = await Bun.file(indexPath).exists();
    expect(fileExists).toBe(true);
  });

  test("returns error result when client fails", async () => {
    mkdirSync(tempDir, { recursive: true });
    const indexPath = join(tempDir, "scvd-index.json");
    const client = createMockClient();

    client.fetchAllFindings = async () => {
      throw new Error("SCVD unavailable");
    };

    const result = await syncAll(client, indexPath);

    expect(result.success).toBe(false);
    expect(result.newFindings).toBe(0);
    expect(result.totalIndexed).toBe(0);
    expect(result.error).toContain("SCVD unavailable");
  });
});

describe("syncIncremental", () => {
  test("returns early when stats total matches existing index", async () => {
    mkdirSync(tempDir, { recursive: true });
    const indexPath = join(tempDir, "scvd-index.json");
    const client = createMockClient();

    client.fetchAllFindings = async () => [createFinding("SCVD-1")];
    await syncAll(client, indexPath);

    let fetchAllCalled = false;
    client.fetchStats = async () => ({
      total: 1,
      by_severity: { High: 1 },
      last_updated: "2026-02-16T00:00:00.000Z",
    });
    client.fetchAllFindings = async () => {
      fetchAllCalled = true;
      return [createFinding("SCVD-1")];
    };

    const result = await syncIncremental(client, indexPath);

    expect(result.success).toBe(true);
    expect(result.newFindings).toBe(0);
    expect(result.totalIndexed).toBe(1);
    expect(fetchAllCalled).toBe(false);
  });

  test("runs full sync when totals differ", async () => {
    mkdirSync(tempDir, { recursive: true });
    const indexPath = join(tempDir, "scvd-index.json");
    const client = createMockClient();

    client.fetchStats = async () => ({
      total: 2,
      by_severity: { High: 2 },
      last_updated: "2026-02-16T00:00:00.000Z",
    });
    client.fetchAllFindings = async () => [createFinding("SCVD-1"), createFinding("SCVD-2")];

    const result = await syncIncremental(client, indexPath);

    expect(result.success).toBe(true);
    expect(result.newFindings).toBe(2);
    expect(result.totalIndexed).toBe(2);
  });
});

describe("getSyncStatus", () => {
  test("returns unhealthy status when index missing", async () => {
    const status = await getSyncStatus(join(tempDir, "missing.json"));
    expect(status.healthy).toBe(false);
    expect(status.totalFindings).toBe(0);
    expect(status.lastSync).toBeNull();
  });

  test("returns healthy status from existing index", async () => {
    mkdirSync(tempDir, { recursive: true });
    const indexPath = join(tempDir, "scvd-index.json");
    const client = createMockClient();
    client.fetchAllFindings = async () => [createFinding("SCVD-1")];

    await syncAll(client, indexPath);
    const status = await getSyncStatus(indexPath);

    expect(status.healthy).toBe(true);
    expect(status.totalFindings).toBe(1);
    expect(status.lastSync).not.toBeNull();
  });
});
