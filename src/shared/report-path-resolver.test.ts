import { expect, test } from "bun:test"
import {
  formatReportDate,
  ReportPathError,
  resolveReportPath,
  sanitizeContractName,
} from "./report-path-resolver"

const FIXED_DATE = new Date("2026-02-21T12:00:00.000Z")
const FIXED_OUTPUT_DIR = "/tmp/reports"

test("same inputs always produce same filePath (stability)", () => {
  const result1 = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  const result2 = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  expect(result1.filePath).toBe(result2.filePath)
  expect(result1.filename).toBe(result2.filename)
})

test("date format is always YYYY-MM-DD (not timestamp)", () => {
  const result = resolveReportPath({
    contractName: "MyContract",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  expect(result.filename).toMatch(/\d{4}-\d{2}-\d{2}\.md$/)
  expect(result.filename).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  expect(result.filename).not.toMatch(/\d{13}/)
})

test("empty contractName throws ReportPathError", () => {
  expect(() =>
    resolveReportPath({
      contractName: "",
      date: FIXED_DATE,
      outputDir: FIXED_OUTPUT_DIR,
    }),
  ).toThrow(ReportPathError)
})

test("whitespace-only contractName throws ReportPathError", () => {
  expect(() =>
    resolveReportPath({
      contractName: "   ",
      date: FIXED_DATE,
      outputDir: FIXED_OUTPUT_DIR,
    }),
  ).toThrow(ReportPathError)
})

test("empty outputDir throws ReportPathError", () => {
  expect(() =>
    resolveReportPath({
      contractName: "VulnerableVault",
      date: FIXED_DATE,
      outputDir: "",
    }),
  ).toThrow(ReportPathError)
})

test("whitespace-only outputDir throws ReportPathError", () => {
  expect(() =>
    resolveReportPath({
      contractName: "VulnerableVault",
      date: FIXED_DATE,
      outputDir: "   ",
    }),
  ).toThrow(ReportPathError)
})

test("formatReportDate returns YYYY-MM-DD", () => {
  expect(formatReportDate(new Date("2026-02-21"))).toBe("2026-02-21")
})

test("formatReportDate pads month and day", () => {
  expect(formatReportDate(new Date("2026-01-05"))).toBe("2026-01-05")
})

test("sanitizeContractName converts spaces to hyphens", () => {
  const result = sanitizeContractName("Vulnerable Vault")
  expect(result).toBe("Vulnerable-Vault")
})

test("sanitizeContractName strips special chars", () => {
  const result = sanitizeContractName("My@Contract!")
  expect(result).toBe("MyContract")
})

test("sanitizeContractName preserves PascalCase without spaces", () => {
  const result = sanitizeContractName("VulnerableVault")
  expect(result).toBe("VulnerableVault")
})

test("sanitizeContractName collapses multiple spaces to single hyphen", () => {
  const result = sanitizeContractName("My  Contract")
  expect(result).toBe("My-Contract")
})

test("override outputDir is used in filePath", () => {
  const customDir = "/custom/output/dir"
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: customDir,
  })
  expect(result.filePath).toContain(customDir)
  expect(result.outputDir).toBe(customDir)
})

test("canonicalId uses runId when provided", () => {
  const runId = "run-abc-123"
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
    runId,
  })
  expect(result.canonicalId).toBe(runId)
})

test("canonicalId falls back to filename when runId not provided", () => {
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  expect(result.canonicalId).toBe(result.filename)
})

test("canonical filename format is {name}-security-audit-{YYYY-MM-DD}.md", () => {
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  expect(result.filename).toBe("VulnerableVault-security-audit-2026-02-21.md")
})

test("filePath joins outputDir and filename", () => {
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    date: FIXED_DATE,
    outputDir: FIXED_OUTPUT_DIR,
  })
  expect(result.filePath).toBe(`${FIXED_OUTPUT_DIR}/VulnerableVault-security-audit-2026-02-21.md`)
})

test("uses current date when date not provided", () => {
  const before = new Date()
  const result = resolveReportPath({
    contractName: "VulnerableVault",
    outputDir: FIXED_OUTPUT_DIR,
  })
  const after = new Date()
  const todayStr = formatReportDate(before)
  const tomorrowStr = formatReportDate(after)
  const matchedDate = result.filename.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""
  expect([todayStr, tomorrowStr]).toContain(matchedDate)
})


test("formatReportDate uses UTC date regardless of local timezone (timezone boundary)", () => {
  // A Date at UTC midnight: local time in UTC-N timezones would show the previous day
  const utcMidnight = new Date("2024-01-15T00:00:00Z")
  expect(formatReportDate(utcMidnight)).toBe("2024-01-15")
})

test("formatReportDate UTC midnight end-of-year boundary", () => {
  // 2023-12-31T00:00:00Z — local UTC-5 would see 2023-12-30
  const utcMidnightNewYear = new Date("2023-12-31T00:00:00Z")
  expect(formatReportDate(utcMidnightNewYear)).toBe("2023-12-31")
})