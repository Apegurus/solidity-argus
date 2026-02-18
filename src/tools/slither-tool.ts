import { createHash } from "crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { tool, type ToolContext } from "@opencode-ai/plugin";
import type { Finding, FindingSeverity } from "../state/types";
import { hasBinary as hasBinaryShared, parseSolcVersion as parseSolcVersionShared, extractContractNames as extractContractNamesShared } from "../shared/binary-utils";

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

const FALLBACK_TRIGGERS = [
  "Contract",
  "not found",
  "AssertionError",
  "crytic_compile",
  "empty AST",
  "Compilation failed",
];

function shouldTryFlattenFallback(errors: string[], stderr: string): boolean {
  const combined = [...errors, stderr].join(" ");
  return FALLBACK_TRIGGERS.some((trigger) => combined.includes(trigger));
}

const parseSolcVersion = parseSolcVersionShared
const extractContractNames = extractContractNamesShared
const hasBinary = hasBinaryShared

function ensureSolc(version: string): boolean {
  if (hasBinary("solc")) return true;
  if (!hasBinary("solc-select")) return false;
  try {
    execSync(`solc-select install ${version} && solc-select use ${version}`, {
      stdio: "ignore",
      timeout: 60_000,
    });
    return true;
  } catch (_e) {
    return false;
  }
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

export type FlattenFallbackDeps = {
  runCommand: RunSlitherCommand;
  hasBinary: (name: string) => boolean;
  ensureSolc: (version: string) => boolean;
  parseSolcVersion: (target: string) => string | undefined;
  extractContractNames: (filePath: string) => string[];
  execSyncFn: typeof execSync;
};

const defaultFlattenDeps: FlattenFallbackDeps = {
  runCommand: runSlitherCommand,
  hasBinary,
  ensureSolc,
  parseSolcVersion,
  extractContractNames,
  execSyncFn: execSync,
};

export async function flattenFallback(
  args: SlitherArgs,
  context: ToolContext,
  deps: FlattenFallbackDeps = defaultFlattenDeps,
): Promise<SlitherAnalyzeResult | undefined> {
  const startedAt = Date.now();

  if (!deps.hasBinary("forge")) {
    return undefined;
  }

  const solcVersion = args.solc_version ?? deps.parseSolcVersion(args.target);
  if (!solcVersion) {
    return undefined;
  }

  if (!deps.ensureSolc(solcVersion)) {
    return {
      success: false,
      findingsCount: 0,
      findings: [],
      executionTime: Date.now() - startedAt,
      errors: ["solc not available and solc-select not found"],
      error: "Flatten fallback requires solc on PATH. Install with: pipx install solc-select && solc-select install " + solcVersion,
    };
  }

  const srcDir = join(args.target, "src");
  let solFiles: string[] = [];
  if (args.target.endsWith(".sol")) {
    solFiles = [args.target];
  } else if (existsSync(srcDir)) {
    try {
      solFiles = deps.execSyncFn(`find "${srcDir}" -name "*.sol" -maxdepth 3 -not -path "*/mocks/*" -not -path "*/test/*"`, {
        encoding: "utf-8",
        timeout: 5_000,
      })
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch (_e) {
      return undefined;
    }
  }

  if (solFiles.length === 0) return undefined;

  const tmpDir = mkdtempSync(join(tmpdir(), "argus-slither-"));
  const allFindings: Finding[] = [];
  const errors: string[] = [];

  try {
    for (const solFile of solFiles) {
      if (context.abort.aborted) break;

      const baseName = solFile.split("/").pop()?.replace(".sol", "") ?? "Contract";
      const flatFile = join(tmpDir, `${baseName}.flat.sol`);
      const originalContracts = deps.extractContractNames(solFile);

      try {
        const flattened = deps.execSyncFn(`forge flatten "${solFile}"`, {
          encoding: "utf-8",
          timeout: 30_000,
          cwd: args.target.endsWith(".sol") ? undefined : args.target,
        });
        writeFileSync(flatFile, flattened);
      } catch (_e) {
        errors.push(`forge flatten failed for ${solFile}`);
        continue;
      }

      const command = [
        "slither",
        flatFile,
        "--json",
        "-",
        "--solc-solcs-select",
        solcVersion,
      ];

      try {
        const runResult = await deps.runCommand(command, context.abort);

        let payload: SlitherPayload;
        try {
          payload = JSON.parse(runResult.stdout) as SlitherPayload;
        } catch (_e) {
          if (runResult.stderr.trim()) errors.push(runResult.stderr.trim());
          continue;
        }

        const rawFindings = parseFindings(payload);
        const filtered = originalContracts.length > 0
          ? rawFindings.filter((f) => {
              if (f.file.includes(".flat.sol") || f.file === flatFile) return true;
              return originalContracts.some(
                (name) => f.description.includes(name) || f.file.includes(name)
              );
            })
          : rawFindings;

        const remapped = filtered.map((f) => ({
          ...f,
          file: f.file.includes(".flat.sol") ? solFile.replace(args.target + "/", "") : f.file,
        }));

        allFindings.push(...remapped);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Slither flatten fallback failed for ${baseName}: ${msg}`);
      }
    }

    return {
      success: allFindings.length > 0 || errors.length === 0,
      findingsCount: allFindings.length,
      findings: allFindings,
      executionTime: Date.now() - startedAt,
      errors: errors.length > 0 ? [`[flatten-fallback] ${errors.join("; ")}`] : ["[flatten-fallback] Analysis completed via forge flatten"],
    };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (_cleanupErr) {
      // best-effort: temp dir cleanup failure is non-fatal
    }
  }
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
      if (shouldTryFlattenFallback(errors, runResult.stderr)) {
        const fallbackResult = await flattenFallback(args, context, {
          ...defaultFlattenDeps,
          runCommand,
        });
        if (fallbackResult) return fallbackResult;
      }
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

    if (!success && findings.length === 0 && shouldTryFlattenFallback(errors, runResult.stderr)) {
      const fallbackResult = await flattenFallback(args, context, {
        ...defaultFlattenDeps,
        runCommand,
      });
      if (fallbackResult) return fallbackResult;
    }

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
