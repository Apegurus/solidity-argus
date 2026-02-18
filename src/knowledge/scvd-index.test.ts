import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, loadIndex, saveIndex, searchIndex } from "./scvd-index";
import type { ScvdFinding } from "./scvd-client";

function createFinding(
  id: string,
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational",
  title: string,
  description: string,
  swc: string[]
): ScvdFinding {
  return {
    scvd_id: id,
    doc_id: `doc-${id}`,
    title,
    description_md: description,
    severity,
    taxonomy: {
      swc,
      cwe: ["CWE-703"],
    },
    repo: {
      url: "https://github.com/example/repo",
    },
    sections: {},
  };
}

const tempDir = "/tmp/argus-scvd-index-tests";

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("buildIndex", () => {
  test("builds compact entries and metadata", () => {
    const findings = [
      createFinding(
        "SCVD-1",
        "High",
        "Reentrancy in withdraw",
        "External call before state update allows repeated withdrawals.",
        ["SWC-107"]
      ),
      createFinding(
        "SCVD-2",
        "Medium",
        "Unchecked transfer result",
        "ERC20 transfer return value ignored.",
        ["SWC-104"]
      ),
    ];

    const index = buildIndex(findings);

    expect(index.version).toBe(1);
    expect(index.totalFindings).toBe(2);
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0]?.id).toBe("SCVD-1");
    expect(index.entries[0]?.swc).toEqual(["SWC-107"]);
    expect(index.entries[0]?.keywords).toContain("reentrancy");
    expect(index.entries[0]?.keywords).toContain("withdraw");
  });
});

describe("searchIndex", () => {
  const index = buildIndex([
    createFinding(
      "SCVD-1",
      "High",
      "Reentrancy in withdraw",
      "External call before state update allows repeated withdrawals.",
      ["SWC-107"]
    ),
    createFinding(
      "SCVD-2",
      "Critical",
      "Access control bypass",
      "Missing onlyOwner check allows admin theft.",
      ["SWC-105"]
    ),
    createFinding(
      "SCVD-3",
      "Low",
      "Missing event",
      "State-changing operations should emit events.",
      ["SWC-132"]
    ),
  ]);

  test("filters by exact SWC", () => {
    const results = searchIndex(index, { swc: "SWC-107" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("SCVD-1");
  });

  test("filters by exact severity", () => {
    const results = searchIndex(index, { severity: "Critical" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("SCVD-2");
  });

  test("filters by keyword substring", () => {
    const results = searchIndex(index, { keyword: "withdr" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("SCVD-1");
  });

  test("combines filters with AND logic", () => {
    const results = searchIndex(index, {
      swc: "SWC-107",
      severity: "High",
      keyword: "reentrancy",
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("SCVD-1");
  });

  test("applies default limit of 10 and custom limit", () => {
    const many = buildIndex(
      Array.from({ length: 20 }).map((_, idx) =>
        createFinding(
          `SCVD-${idx + 1}`,
          "High",
          `Issue ${idx + 1}`,
          "keyword shared text",
          ["SWC-107"]
        )
      )
    );

    const defaultLimited = searchIndex(many, { keyword: "keyword" });
    const customLimited = searchIndex(many, { keyword: "keyword", limit: 3 });

    expect(defaultLimited).toHaveLength(10);
    expect(customLimited).toHaveLength(3);
  });
});

describe("saveIndex/loadIndex", () => {
  test("saves and loads index JSON", async () => {
    mkdirSync(tempDir, { recursive: true });
    const filePath = join(tempDir, "scvd-index.json");
    const index = buildIndex([
      createFinding(
        "SCVD-1",
        "High",
        "Reentrancy in withdraw",
        "External call before state update allows repeated withdrawals.",
        ["SWC-107"]
      ),
    ]);

    await saveIndex(index, filePath);
    const loaded = await loadIndex(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded?.totalFindings).toBe(1);
    expect(loaded?.entries[0]?.id).toBe("SCVD-1");
  });

  test("loadIndex returns null when file does not exist", async () => {
    const missingPath = join(tempDir, "missing.json");
    const loaded = await loadIndex(missingPath);
    expect(loaded).toBeNull();
  });
});
