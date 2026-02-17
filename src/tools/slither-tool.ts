import { createHash } from "crypto";
import { tool, type ToolContext } from "@opencode-ai/plugin";
import type { Finding, FindingSeverity } from "../state/types";

type SlitherArgs = {
  target: string;
  detectors?: string[];
  exclude?: string[];
  solc_version?: string;
};

type SlitherDetector = {
  check?: string;
  impact?: string;
  confidence?: string;
  description?: string;
  elements?: Array<{
    source_mapping?: {
      filename_relative?: string;
      lines?: number[];
    };
  }>;
};

type SlitherPayload = {
  success?: boolean;
  error?: string | null;
  results?: {
    detectors?: SlitherDetector[];
  };
};

export type SlitherRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunSlitherCommand = (
  command: string[],
  signal: AbortSignal
) => Promise<SlitherRunResult>;

export type SlitherAnalyzeResult = {
  success: boolean;
  findingsCount: number;
  findings: Finding[];
  executionTime: number;
  errors: string[];
  error?: string;
};

function mapSeverity(impact?: string): FindingSeverity {
  switch (impact) {
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
    case "Informational":
      return "Informational";
    default:
      return "Informational";
  }
}

function mapConfidence(confidence?: string): "High" | "Medium" | "Low" {
  switch (confidence) {
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
    default:
      return "Low";
  }
}

function findingLines(lines?: number[]): [number, number] {
  if (!lines || lines.length === 0) {
    return [1, 1];
  }

  if (lines.length === 1) {
    const only = lines[0] ?? 1;
    return [only, only];
  }

  const start = lines[0] ?? 1;
  const end = lines[lines.length - 1] ?? start;
  return [start, end];
}

function createFindingID(check: string, file: string, lines: [number, number]): string {
  const key = `${check}:${file}:${lines[0]}-${lines[1]}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function buildCommand(args: SlitherArgs): string[] {
  const command = [
    "slither",
    args.target,
    "--json",
    "-",
    "--filter-paths",
    "node_modules",
  ];

  if (args.detectors && args.detectors.length > 0) {
    command.push("--detect", args.detectors.join(","));
  }

  if (args.exclude && args.exclude.length > 0) {
    command.push("--exclude-detectors", args.exclude.join(","));
  }

  if (args.solc_version) {
    command.push("--solc", `solc:${args.solc_version}`);
  }

  return command;
}

function parseFindings(payload: SlitherPayload): Finding[] {
  const detectors = payload.results?.detectors ?? [];

  return detectors.map((detector) => {
    const file = detector.elements?.[0]?.source_mapping?.filename_relative ?? "unknown";
    const lines = findingLines(detector.elements?.[0]?.source_mapping?.lines);
    const check = detector.check ?? "unknown-check";

    return {
      id: createFindingID(check, file, lines),
      check,
      severity: mapSeverity(detector.impact),
      confidence: mapConfidence(detector.confidence),
      description: detector.description ?? "",
      file,
      lines,
      source: "slither",
    };
  });
}

export const runSlitherCommand: RunSlitherCommand = async (command, signal) => {
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
};

export async function executeSlitherAnalyze(
  args: SlitherArgs,
  context: ToolContext,
  runCommand: RunSlitherCommand = runSlitherCommand
): Promise<SlitherAnalyzeResult> {
  const startedAt = Date.now();
  const command = buildCommand(args);
  context.metadata({ title: `Slither analysis: ${args.target}` });

  try {
    const runResult = await runCommand(command, context.abort);
    const errors: string[] = [];

    if (runResult.exitCode !== 0) {
      errors.push(`Slither exited with code ${runResult.exitCode}`);
    }
    if (runResult.stderr.trim().length > 0) {
      errors.push(runResult.stderr.trim());
    }

    let payload: SlitherPayload;
    try {
      payload = JSON.parse(runResult.stdout) as SlitherPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors,
        error: `Slither output parse error: ${message}`,
      };
    }

    if (payload.error) {
      errors.push(payload.error);
    }

    const findings = parseFindings(payload);
    const success = findings.length > 0 || (runResult.exitCode === 0 && payload.success !== false);

    return {
      success,
      findingsCount: findings.length,
      findings,
      executionTime: Date.now() - startedAt,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const maybeErrno = error as Error & { code?: string; name?: string };

    if (maybeErrno.code === "ENOENT") {
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors: [],
        error: "Slither not found. Install with: pip install slither-analyzer",
      };
    }

    if (maybeErrno.name === "AbortError" || context.abort.aborted) {
      return {
        success: false,
        findingsCount: 0,
        findings: [],
        executionTime: Date.now() - startedAt,
        errors: ["Slither analysis aborted"],
        error: "Slither analysis aborted",
      };
    }

    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: [message],
      error: message,
    };
  }
}

export const slitherTool = tool({
  description:
    "Run Slither static analysis and return normalized findings for Solidity targets.",
  args: {
    target: tool.schema.string(),
    detectors: tool.schema.array(tool.schema.string()).optional(),
    exclude: tool.schema.array(tool.schema.string()).optional(),
    solc_version: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const result = await executeSlitherAnalyze(args, context);
    return JSON.stringify(result);
  },
});
