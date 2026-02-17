import { tool, type ToolContext } from "@opencode-ai/plugin";
import type { AuditState, Finding, FindingSeverity } from "../state/types";

type SeverityThreshold = "critical" | "high" | "medium" | "low" | "informational";

type ReportGeneratorArgs = {
  project_name: string;
  scope: string[];
  include_executive_summary?: boolean;
  severity_threshold?: SeverityThreshold;
  audit_state: string;
};

type FindingsCount = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
};

export type ReportGenerationResult = {
  report: string;
  findingsCount: FindingsCount;
  filename: string;
};

const SEVERITY_ORDER: FindingSeverity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
];

const SEVERITY_PREFIX: Record<FindingSeverity, string> = {
  Critical: "CRIT",
  High: "HIGH",
  Medium: "MED",
  Low: "LOW",
  Informational: "INFO",
};

const THRESHOLD_WEIGHT: Record<SeverityThreshold, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

const FINDING_WEIGHT: Record<FindingSeverity, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
};

function emptyCounts(): FindingsCount {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
}

function parseAuditState(auditState: string): Finding[] {
  const parsed = JSON.parse(auditState) as AuditState | Finding[];

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.findings)) {
    return parsed.findings;
  }

  return [];
}

function normalizeTitle(check: string): string {
  return check
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatLocation(finding: Finding): string {
  return `${finding.file}:${finding.lines[0]}-${finding.lines[1]}`;
}

function shouldIncludeFinding(finding: Finding, threshold: SeverityThreshold): boolean {
  return FINDING_WEIGHT[finding.severity] >= THRESHOLD_WEIGHT[threshold];
}

function calculateCounts(findings: Finding[]): FindingsCount {
  const counts = emptyCounts();

  for (const finding of findings) {
    if (finding.severity === "Critical") counts.critical += 1;
    if (finding.severity === "High") counts.high += 1;
    if (finding.severity === "Medium") counts.medium += 1;
    if (finding.severity === "Low") counts.low += 1;
    if (finding.severity === "Informational") counts.informational += 1;
  }

  return counts;
}

function overallRiskAssessment(counts: FindingsCount): string {
  if (counts.critical > 0) return "Critical risk";
  if (counts.high > 0) return "High risk";
  if (counts.medium > 0) return "Medium risk";
  if (counts.low > 0) return "Low risk";
  if (counts.informational > 0) return "Informational only";
  return "No significant risk identified";
}

function genericImpact(severity: FindingSeverity): string {
  if (severity === "Critical") {
    return "Could lead to immediate and severe compromise of funds or protocol control.";
  }
  if (severity === "High") {
    return "Could materially impact protocol security, user funds, or system integrity.";
  }
  if (severity === "Medium") {
    return "Could cause operational issues or increase exploitability under specific conditions.";
  }
  if (severity === "Low") {
    return "Limited direct impact but should be addressed to improve security posture.";
  }
  return "No immediate exploit impact, but useful for hardening and maintainability.";
}

function genericRecommendation(severity: FindingSeverity): string {
  if (severity === "Critical" || severity === "High") {
    return "Prioritize remediation before production deployment and validate with focused regression tests.";
  }
  if (severity === "Medium") {
    return "Address in the near term and include unit/integration tests to prevent regressions.";
  }
  if (severity === "Low") {
    return "Schedule remediation in regular hardening cycles.";
  }
  return "Track and resolve during routine code quality and documentation improvements.";
}

function buildRecommendations(counts: FindingsCount): string[] {
  const items: string[] = [];

  if (counts.critical > 0) {
    items.push("1. Immediately remediate all Critical findings and block release until fixes are verified.");
  }
  if (counts.high > 0) {
    items.push("2. Prioritize High findings in the next patch cycle with dedicated security test coverage.");
  }
  if (counts.medium > 0) {
    items.push("3. Resolve Medium findings to reduce attack surface and improve resilience.");
  }
  if (counts.low > 0 || counts.informational > 0) {
    items.push("4. Address Low/Informational findings as part of ongoing hardening and code quality efforts.");
  }

  if (items.length === 0) {
    items.push("1. Maintain current controls, monitor code changes, and re-audit before major upgrades.");
  }

  return items;
}

function buildFindingsSection(findings: Finding[]): string {
  if (findings.length === 0) {
    return "## Findings\nNo findings meet the configured severity threshold.";
  }

  const lines: string[] = ["## Findings"];

  for (const severity of SEVERITY_ORDER) {
    const severityFindings = findings.filter((finding) => finding.severity === severity);
    if (severityFindings.length === 0) {
      continue;
    }

    lines.push(`### ${severity}`);

    severityFindings.forEach((finding, index) => {
      const prefix = SEVERITY_PREFIX[severity];
      const findingId = `[${prefix}-${index + 1}]`;
      const title = normalizeTitle(finding.check);
      const recommendation = finding.remediation ?? genericRecommendation(severity);

      lines.push(`### ${findingId} ${title}`);
      lines.push(`**Severity**: ${finding.severity}`);
      lines.push(`**Confidence**: ${finding.confidence}`);
      lines.push(`**Location**: ${formatLocation(finding)}`);
      lines.push("");
      lines.push(`**Description**: ${finding.description}`);
      lines.push("");
      lines.push(`**Impact**: ${genericImpact(finding.severity)}`);
      lines.push("");
      lines.push(`**Recommendation**: ${recommendation}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}

export async function executeReportGeneration(
  args: ReportGeneratorArgs,
  context: ToolContext
): Promise<ReportGenerationResult> {
  const includeExecutiveSummary = args.include_executive_summary ?? true;
  const threshold = args.severity_threshold ?? "low";
  const findings = parseAuditState(args.audit_state).filter((finding) =>
    shouldIncludeFinding(finding, threshold)
  );
  const counts = calculateCounts(findings);
  const auditDate = new Date().toISOString().slice(0, 10);

  context.metadata({ title: `Generate audit report: ${args.project_name}` });

  const sections: string[] = [`# Security Audit Report — ${args.project_name}`];

  if (includeExecutiveSummary) {
    sections.push("## Executive Summary");
    sections.push(
      `This report summarizes security findings identified for ${args.project_name} based on static analysis, testing, and pattern-based review.`
    );
    sections.push("");
    sections.push("| Severity | Count |");
    sections.push("| --- | ---: |");
    sections.push(`| Critical | ${counts.critical} |`);
    sections.push(`| High | ${counts.high} |`);
    sections.push(`| Medium | ${counts.medium} |`);
    sections.push(`| Low | ${counts.low} |`);
    sections.push(`| Informational | ${counts.informational} |`);
    sections.push("");
    sections.push(`Overall risk assessment: ${overallRiskAssessment(counts)}.`);
  }

  sections.push("## Scope");
  sections.push("Contracts in scope:");
  if (args.scope.length === 0) {
    sections.push("- None provided");
  } else {
    for (const contract of args.scope) {
      sections.push(`- ${contract}`);
    }
  }
  sections.push(`Audit date: ${auditDate}`);

  sections.push("## Methodology");
  sections.push("Tools and techniques used:");
  sections.push("- Slither static analysis");
  sections.push("- Foundry tests and fuzzing");
  sections.push("- Pattern Analysis");
  sections.push("- Solodit research cross-referencing");
  sections.push(
    "Approach: Findings were normalized, deduplicated by detector signature and location, then prioritized by severity and confidence."
  );

  sections.push(buildFindingsSection(findings));

  sections.push("## Recommendations");
  for (const item of buildRecommendations(counts)) {
    sections.push(`- ${item}`);
  }

  sections.push("## Appendix");
  sections.push("Tool execution summary:");
  sections.push("- Data source: `audit_state` payload");
  sections.push(`- Severity threshold applied: ${threshold}`);
  sections.push(`- Findings included in report: ${findings.length}`);

  return {
    report: sections.join("\n\n"),
    findingsCount: counts,
    filename: `${args.project_name}-audit-report-${auditDate}.md`,
  };
}

export const reportGeneratorTool = tool({
  description:
    "Generate a professional markdown security audit report from serialized findings and audit context.",
  args: {
    project_name: tool.schema.string(),
    scope: tool.schema.array(tool.schema.string()),
    include_executive_summary: tool.schema.boolean().default(true),
    severity_threshold: tool.schema
      .enum(["critical", "high", "medium", "low", "informational"])
      .default("low"),
    audit_state: tool.schema.string(),
  },
  async execute(args, context) {
    const result = await executeReportGeneration(args, context);
    return JSON.stringify(result);
  },
});
