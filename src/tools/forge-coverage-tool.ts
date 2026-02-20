import { tool, type ToolContext } from "@opencode-ai/plugin";
import { resolveProjectDir } from "../shared/project-utils";

type ForgeCoverageArgs = {
  target?: string;
};

type NormalizedForgeCoverageArgs = {
  target: string;
};

type ForgeCoverageFile = {
  path: string;
  linesPct: number;
  statementsPct: number;
  branchesPct: number;
  functionsPct: number;
};

type ForgeCoverageSummary = {
  totalLinesPct: number;
  totalStatementsPct: number;
  totalBranchesPct: number;
  totalFunctionsPct: number;
};

type ForgeCoverageReport = {
  files: ForgeCoverageFile[];
  summary: ForgeCoverageSummary;
};

type ForgeCoverageResult = {
  success: boolean;
  report: ForgeCoverageReport;
  executionTime: number;
  error?: string;
};

export type ForgeCommandRunner = (
  command: string[],
  signal: AbortSignal,
  cwd: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const EMPTY_SUMMARY: ForgeCoverageSummary = {
  totalLinesPct: 0,
  totalStatementsPct: 0,
  totalBranchesPct: 0,
  totalFunctionsPct: 0,
};

function normalizeArgs(args: ForgeCoverageArgs, context: ToolContext): NormalizedForgeCoverageArgs {
  return {
    target: args.target ?? resolveProjectDir(context),
  };
}

function parsePercent(input: string): number {
  const match = input.match(/(\d+(?:\.\d+)?)%/);
  if (!match?.[1]) {
    return 0;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function parseTableRow(line: string): string[] {
  if (!line.startsWith("|")) {
    return [];
  }
  return line
    .split("|")
    .slice(1, -1)
    .map((item) => item.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) {
    return false;
  }
  return cells.every((cell) => /^-+$/.test(cell));
}

function parseCoverageReport(output: string): ForgeCoverageReport {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  const files: ForgeCoverageFile[] = [];
  let summary: ForgeCoverageSummary = { ...EMPTY_SUMMARY };
  let hasSummary = false;

  for (const line of lines) {
    const cells = parseTableRow(line);
    if (cells.length < 5) {
      continue;
    }

    if (isSeparatorRow(cells)) {
      continue;
    }

    const label = cells[0]?.toLowerCase();
    if (label === "file") {
      continue;
    }

    const rowValues = {
      linesPct: parsePercent(cells[1] ?? "0"),
      statementsPct: parsePercent(cells[2] ?? "0"),
      branchesPct: parsePercent(cells[3] ?? "0"),
      functionsPct: parsePercent(cells[4] ?? "0"),
    };

    if (label === "total") {
      summary = {
        totalLinesPct: rowValues.linesPct,
        totalStatementsPct: rowValues.statementsPct,
        totalBranchesPct: rowValues.branchesPct,
        totalFunctionsPct: rowValues.functionsPct,
      };
      hasSummary = true;
      continue;
    }

    files.push({
      path: cells[0] ?? "unknown",
      ...rowValues,
    });
  }

  if (!hasSummary) {
    throw new Error("Invalid tabular output from forge coverage");
  }

  return { files, summary };
}

const runForgeCommand: ForgeCommandRunner = async (command, signal, cwd) => {
  const child = Bun.spawn(command, {
    cwd,
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

export async function executeForgeCoverage(
  args: ForgeCoverageArgs,
  context: ToolContext,
  runCommand: ForgeCommandRunner = runForgeCommand
): Promise<ForgeCoverageResult> {
  const startedAt = Date.now();
  const normalizedArgs = normalizeArgs(args, context);
  context.metadata({ title: `Run forge coverage: ${normalizedArgs.target}` });

  const fail = (error: string): ForgeCoverageResult => ({
    success: false,
    report: { files: [], summary: { ...EMPTY_SUMMARY } },
    executionTime: Date.now() - startedAt,
    error,
  });

  try {
    const runResult = await runCommand(
      ["forge", "coverage"],
      context.abort,
      normalizedArgs.target
    );

    if (runResult.exitCode !== 0) {
      return fail(
        runResult.stderr.trim() || `forge coverage exited with code ${runResult.exitCode}`
      );
    }

    let report: ForgeCoverageReport;
    try {
      report = parseCoverageReport(runResult.stdout);
    } catch {
      return fail("Invalid tabular output from forge coverage");
    }

    return {
      success: true,
      report,
      executionTime: Date.now() - startedAt,
    };
  } catch (error) {
    if (context.abort.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return fail("forge coverage aborted");
    }

    const maybeError = error as Error & { code?: string };
    if (maybeError.code === "ENOENT") {
      return fail("Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash");
    }
    if (
      maybeError.code === "ETIMEDOUT" ||
      maybeError.message.toLowerCase().includes("timed out")
    ) {
      return fail("forge coverage timed out");
    }

    return fail(maybeError.message || "forge coverage failed");
  }
}

export const forgeCoverageTool = tool({
  description:
    "Run forge coverage analysis and return structured per-file coverage metrics (lines, statements, branches, functions).",
  args: {
    target: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const result = await executeForgeCoverage(args, context);
    return JSON.stringify(result);
  },
});
