import { test, expect, beforeEach, afterEach } from "bun:test";
import { detectAuditArtifacts } from "./audit-artifact-detector";
import type { AuditArtifact } from "./audit-artifact-detector";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "audit-artifact-detector-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("detects audit/ directory as audit-report artifact", () => {
  mkdirSync(join(tempDir, "audit"), { recursive: true });

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("audit-report");
  expect(artifacts[0]?.path).toBe(join(tempDir, "audit"));
  expect(artifacts[0]?.name).toBe("audit");
});

test("detects audits/ directory as audit-report artifact", () => {
  mkdirSync(join(tempDir, "audits"), { recursive: true });

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("audit-report");
  expect(artifacts[0]?.name).toBe("audits");
});

test("detects security/ directory as audit-report artifact", () => {
  mkdirSync(join(tempDir, "security"), { recursive: true });

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("audit-report");
  expect(artifacts[0]?.name).toBe("security");
});

test("detects *audit*.md files as audit-report artifact", () => {
  writeFileSync(join(tempDir, "security-audit.md"), "# Audit Report");
  writeFileSync(join(tempDir, "audit-findings.md"), "# Findings");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(2);
  expect(artifacts.some((a) => a.type === "audit-report" && a.name === "security-audit.md")).toBe(true);
  expect(artifacts.some((a) => a.type === "audit-report" && a.name === "audit-findings.md")).toBe(true);
});

test("detects *audit*.pdf files as audit-report artifact", () => {
  writeFileSync(join(tempDir, "audit-report.pdf"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("audit-report");
  expect(artifacts[0]?.name).toBe("audit-report.pdf");
});

test("detects *security-review* files as audit-report artifact", () => {
  writeFileSync(join(tempDir, "security-review.md"), "");
  writeFileSync(join(tempDir, "security-review-2024.pdf"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(2);
  expect(artifacts.some((a) => a.name === "security-review.md")).toBe(true);
  expect(artifacts.some((a) => a.name === "security-review-2024.pdf")).toBe(true);
});

test("detects slither.json as slither-output artifact", () => {
  writeFileSync(join(tempDir, "slither.json"), "{}");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("slither-output");
  expect(artifacts[0]?.name).toBe("slither.json");
});

test("detects slither.sarif as slither-output artifact", () => {
  writeFileSync(join(tempDir, "slither.sarif"), "{}");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("slither-output");
  expect(artifacts[0]?.name).toBe("slither.sarif");
});

test("detects slither-report* files as slither-output artifact", () => {
  writeFileSync(join(tempDir, "slither-report.md"), "");
  writeFileSync(join(tempDir, "slither-report-2024.json"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(2);
  expect(artifacts.some((a) => a.type === "slither-output" && a.name === "slither-report.md")).toBe(true);
  expect(artifacts.some((a) => a.type === "slither-output" && a.name === "slither-report-2024.json")).toBe(true);
});

test("detects .openzeppelin/ directory as deployment-artifact", () => {
  mkdirSync(join(tempDir, ".openzeppelin"), { recursive: true });

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("deployment-artifact");
  expect(artifacts[0]?.name).toBe(".openzeppelin");
});

test("detects mythril-report* files as security-tool-output artifact", () => {
  writeFileSync(join(tempDir, "mythril-report.md"), "");
  writeFileSync(join(tempDir, "mythril-report-2024.json"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(2);
  expect(artifacts.some((a) => a.type === "security-tool-output" && a.name === "mythril-report.md")).toBe(true);
  expect(artifacts.some((a) => a.type === "security-tool-output" && a.name === "mythril-report-2024.json")).toBe(true);
});

test("detects securify-report* files as security-tool-output artifact", () => {
  writeFileSync(join(tempDir, "securify-report.md"), "");
  writeFileSync(join(tempDir, "securify-report-2024.json"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(2);
  expect(artifacts.some((a) => a.type === "security-tool-output" && a.name === "securify-report.md")).toBe(true);
  expect(artifacts.some((a) => a.type === "security-tool-output" && a.name === "securify-report-2024.json")).toBe(true);
});

test("returns empty array for empty directory", () => {
  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(0);
  expect(artifacts).toEqual([]);
});

test("detects multiple artifact types in same directory", () => {
  mkdirSync(join(tempDir, "audit"), { recursive: true });
  writeFileSync(join(tempDir, "slither.json"), "{}");
  mkdirSync(join(tempDir, ".openzeppelin"), { recursive: true });
  writeFileSync(join(tempDir, "security-audit.md"), "");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(4);
  expect(artifacts.some((a) => a.type === "audit-report" && a.name === "audit")).toBe(true);
  expect(artifacts.some((a) => a.type === "slither-output" && a.name === "slither.json")).toBe(true);
  expect(artifacts.some((a) => a.type === "deployment-artifact" && a.name === ".openzeppelin")).toBe(true);
  expect(artifacts.some((a) => a.type === "audit-report" && a.name === "security-audit.md")).toBe(true);
});

test("ignores non-matching files and directories", () => {
  mkdirSync(join(tempDir, "src"), { recursive: true });
  writeFileSync(join(tempDir, "README.md"), "");
  writeFileSync(join(tempDir, "package.json"), "{}");

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(0);
});

test("detects docs/audit* directories as audit-report artifact", () => {
  mkdirSync(join(tempDir, "docs", "audit-2024"), { recursive: true });

  const artifacts = detectAuditArtifacts(tempDir);

  expect(artifacts.length).toBe(1);
  expect(artifacts[0]?.type).toBe("audit-report");
  expect(artifacts[0]?.name).toBe("audit-2024");
});
