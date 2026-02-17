import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { tool, type ToolContext } from "@opencode-ai/plugin";

export interface Match {
  pattern: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  file: string;
  lines: [number, number];
  description: string;
  exploitReference?: string;
}

export interface MatchSource {
  source: string;
  matches: Match[];
}

export interface PatternCheckResult {
  sources: MatchSource[];
  patternsChecked: number;
  executionTime: number;
  target: string;
}

type PatternCheckArgs = {
  target: string;
  patterns?: string[];
  include_scvd?: boolean;
};

type BuiltinPattern = {
  name: string;
  category: string;
  severity: Match["severity"];
  regex: RegExp;
  description: string;
  exploitReference?: string;
};

const BUILTIN_PATTERNS: BuiltinPattern[] = [
  {
    name: "reentrancy",
    category: "reentrancy",
    severity: "High",
    regex: /\.call\{value:/,
    description: "Potential reentrancy: ETH transfer via low-level call",
    exploitReference: "DAO hack ($60M), 2016",
  },
  {
    name: "tx-origin-auth",
    category: "access-control",
    severity: "High",
    regex: /tx\.origin/,
    description: "Use of tx.origin for authorization - vulnerable to phishing",
  },
  {
    name: "selfdestruct",
    category: "access-control",
    severity: "High",
    regex: /selfdestruct\(|suicide\(/,
    description: "Contract uses selfdestruct - can destroy contract",
  },
  {
    name: "delegatecall",
    category: "delegatecall",
    severity: "High",
    regex: /\.delegatecall\(/,
    description: "Use of delegatecall - can overwrite storage",
  },
  {
    name: "missing-zero-check",
    category: "access-control",
    severity: "Medium",
    regex: /address\(0\)/,
    description: "Potential missing zero-address validation",
  },
];

function collectSolidityFiles(target: string): string[] {
  const absoluteTarget = resolve(target);
  let stats: ReturnType<typeof statSync>;

  try {
    stats = statSync(absoluteTarget);
  } catch {
    throw new Error(`Target does not exist: ${target}`);
  }

  if (stats.isFile()) {
    return extname(absoluteTarget) === ".sol" ? [absoluteTarget] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const discovered: string[] = [];
  const stack = [absoluteTarget];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && extname(entry.name) === ".sol") {
        discovered.push(fullPath);
      }
    }
  }

  return discovered;
}

function lineNumberAt(content: string, index: number): number {
  if (index <= 0) {
    return 1;
  }

  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function lineWindow(content: string, index: number): [number, number] {
  const linesCount = content.split("\n").length;
  const line = lineNumberAt(content, index);
  const start = Math.max(1, line - 5);
  const end = Math.min(linesCount, line + 5);
  return [start, end];
}

function findMatches(file: string, patterns: BuiltinPattern[]): Match[] {
  const content = readFileSync(file, "utf8");
  const matches: Match[] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`);
    for (const found of content.matchAll(regex)) {
      const index = found.index ?? 0;
      matches.push({
        pattern: pattern.name,
        severity: pattern.severity,
        file,
        lines: lineWindow(content, index),
        description: pattern.description,
        exploitReference: pattern.exploitReference,
      });
    }
  }

  return matches;
}

function selectPatterns(categories?: string[]): BuiltinPattern[] {
  if (!categories || categories.length === 0) {
    return BUILTIN_PATTERNS;
  }

  const set = new Set(categories);
  return BUILTIN_PATTERNS.filter((pattern) => set.has(pattern.category));
}

export async function executePatternCheck(
  args: PatternCheckArgs,
  context: ToolContext
): Promise<PatternCheckResult> {
  const startedAt = Date.now();
  context.metadata({ title: `Pattern check: ${args.target}` });

  const selectedPatterns = selectPatterns(args.patterns);
  const solidityFiles = collectSolidityFiles(args.target);
  if (solidityFiles.length === 0) {
    throw new Error(`No Solidity files found for target: ${args.target}`);
  }

  const sourceMatches: Match[] = [];
  for (const solidityFile of solidityFiles) {
    if (context.abort.aborted) {
      throw new Error("pattern check aborted");
    }
    sourceMatches.push(...findMatches(solidityFile, selectedPatterns));
  }

  return {
    sources: [
      {
        source: "pattern-db",
        matches: sourceMatches,
      },
    ],
    patternsChecked: selectedPatterns.length,
    executionTime: Date.now() - startedAt,
    target: args.target,
  };
}

export const patternCheckerTool = tool({
  description: "Check Solidity files against deterministic vulnerability regex patterns.",
  args: {
    target: tool.schema.string(),
    patterns: tool.schema.array(tool.schema.string()).optional(),
    include_scvd: tool.schema.boolean().default(true),
  },
  async execute(args, context) {
    const result = await executePatternCheck(args, context);
    return JSON.stringify(result);
  },
});
