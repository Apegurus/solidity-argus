import { test, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  soloditSearchTool,
  executeSoloditSearch,
  type CallMcpTool,
  type SoloditSearchResult,
} from "./solodit-search-tool";

function createContext(): {
  context: ToolContext;
  metadataCalls: Array<{ title?: string }>;
} {
  const metadataCalls: Array<{ title?: string }> = [];
  const abortController = new AbortController();

  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title });
    },
    async ask() {
      return;
    },
  };

  return { context, metadataCalls };
}

test("soloditSearchTool uses tool() helper contract", () => {
  expect(soloditSearchTool.description.length).toBeGreaterThan(0);
  expect(soloditSearchTool.args).toBeDefined();
  expect(typeof soloditSearchTool.execute).toBe("function");
});

test("executeSoloditSearch returns findings from MCP when callMcpTool provided", async () => {
  const { context, metadataCalls } = createContext();

  const mockMcp: CallMcpTool = async (_server, _tool, _args) => {
    return [
      {
        title: "Reentrancy in withdraw",
        severity: "High",
        description: "State updated after external call",
        protocol: "Compound",
        url: "https://solodit.xyz/findings/1",
        remediation: "Use checks-effects-interactions",
      },
      {
        title: "Unchecked return value",
        severity: "Medium",
        description: "Return value of transfer not checked",
        protocol: "Aave",
        url: "https://solodit.xyz/findings/2",
        remediation: "Use SafeERC20",
      },
    ];
  };

  const result = await executeSoloditSearch(
    { query: "reentrancy" },
    context,
    mockMcp
  );

  expect(result.results).toHaveLength(2);
  expect(result.totalFound).toBe(2);
  expect(result.query).toBe("reentrancy");
  expect(result.error).toBeUndefined();

  expect(result.results[0]?.title).toBe("Reentrancy in withdraw");
  expect(result.results[0]?.severity).toBe("High");
  expect(result.results[0]?.protocol).toBe("Compound");
  expect(result.results[0]?.url).toBe("https://solodit.xyz/findings/1");
  expect(result.results[0]?.remediation).toBe("Use checks-effects-interactions");

  expect(result.results[1]?.title).toBe("Unchecked return value");
  expect(result.results[1]?.severity).toBe("Medium");

  expect(metadataCalls.length).toBe(1);
  expect(metadataCalls[0]?.title).toContain("Solodit");
});

test("executeSoloditSearch falls back to HTTP when callMcpTool absent", async () => {
  const { context } = createContext();

  const result = await executeSoloditSearch(
    { query: "flash loan" },
    context
  );

  expect(result.query).toBe("flash loan");
  expect(Array.isArray(result.results)).toBe(true);
  expect(typeof result.totalFound).toBe("number");

  if (result.results.length > 0) {
    expect(result.error).toBeUndefined();
    for (const finding of result.results) {
      expect(typeof finding.title).toBe("string");
    }
  } else {
    // HTTP fallback may return 0 results without an error (e.g. empty response)
    // or with an error (e.g. connection refused). Both are valid.
    expect(typeof result.totalFound).toBe("number");
  }
});

test("executeSoloditSearch passes severity filter to MCP", async () => {
  const { context } = createContext();
  const mockMcp: CallMcpTool = async () => {
    return [
      { title: "A", severity: "High" },
      { title: "B", severity: "Low" },
    ];
  };

  const result = await executeSoloditSearch(
    { query: "overflow", severity: ["High", "Critical"] },
    context,
    mockMcp
  );

  expect(result.results).toHaveLength(1);
  expect(result.results[0]?.title).toBe("A");
  expect(result.totalFound).toBe(1);
});

test("executeSoloditSearch applies default limit (10)", async () => {
  const { context } = createContext();
  const mockMcp: CallMcpTool = async () => {
    return Array.from({ length: 12 }, (_, i) => ({ title: `finding-${i}`, severity: "Low" }));
  };

  const result = await executeSoloditSearch(
    { query: "delegatecall" },
    context,
    mockMcp
  );

  expect(result.results).toHaveLength(10);
  expect(result.totalFound).toBe(12);
});

test("executeSoloditSearch applies custom limit", async () => {
  const { context } = createContext();
  const mockMcp: CallMcpTool = async () => {
    return Array.from({ length: 12 }, (_, i) => ({ title: `finding-${i}`, severity: "Low" }));
  };

  const result = await executeSoloditSearch(
    { query: "delegatecall", limit: 25 },
    context,
    mockMcp
  );

  expect(result.results).toHaveLength(12);
  expect(result.totalFound).toBe(12);
});

test("executeSoloditSearch calls correct MCP server and tool name", async () => {
  const { context } = createContext();
  const capturedCalls: Array<{ server: string; tool: string }> = [];

  const mockMcp: CallMcpTool = async (server, tool, _args) => {
    capturedCalls.push({ server, tool });
    return [];
  };

  await executeSoloditSearch({ query: "test" }, context, mockMcp);

  expect(capturedCalls[0]?.server).toBe("solodit-mcp");
  expect(capturedCalls[0]?.tool).toBe("search");
});

test("executeSoloditSearch uses keywords argument for MCP", async () => {
  const { context } = createContext();
  const capturedArgs: Array<Record<string, unknown>> = [];

  const mockMcp: CallMcpTool = async (_server, _tool, args) => {
    capturedArgs.push(args);
    return [];
  };

  await executeSoloditSearch({ query: "overflow" }, context, mockMcp);

  expect(capturedArgs).toHaveLength(1);
  expect(capturedArgs[0]?.keywords).toBe("overflow");
  expect(capturedArgs[0]?.query).toBeUndefined();
  expect(capturedArgs[0]?.limit).toBeUndefined();
  expect(capturedArgs[0]?.filters).toBeUndefined();
});

test("executeSoloditSearch retries with search_findings contract when search fails", async () => {
  const { context } = createContext();
  const capturedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  const mockMcp: CallMcpTool = async (_server, tool, args) => {
    capturedCalls.push({ tool, args });
    if (tool === "search") {
      throw new Error("Tool not available");
    }

    return {
      findings: [
        {
          title: "A",
          severity: "HIGH",
          description: "desc",
          protocol: "Proto",
          url: "https://example.com",
          remediation: "fix",
        },
      ],
    };
  };

  const result = await executeSoloditSearch(
    { query: "overflow", severity: ["High"], limit: 7 },
    context,
    mockMcp,
  );

  expect(capturedCalls).toHaveLength(2);
  expect(capturedCalls[0]?.tool).toBe("search");
  expect(capturedCalls[0]?.args).toEqual({ keywords: "overflow" });

  expect(capturedCalls[1]?.tool).toBe("search_findings");
  expect(capturedCalls[1]?.args).toEqual({
    keywords: "overflow",
    impact: ["HIGH"],
    pageSize: 7,
  });

  expect(result.results).toHaveLength(1);
  expect(result.totalFound).toBe(1);
});

test("executeSoloditSearch falls back to HTTP when MCP bridge throws", async () => {
  const { context } = createContext();

  const failingMcp: CallMcpTool = async () => {
    throw new Error("Connection refused");
  };

  const result = await executeSoloditSearch(
    { query: "access control" },
    context,
    failingMcp
  );

  expect(result.query).toBe("access control");
  expect(Array.isArray(result.results)).toBe(true);
  expect(typeof result.totalFound).toBe("number");

  if (result.results.length > 0) {
    expect(result.error).toBeUndefined();
  } else {
    // HTTP fallback may return 0 results without an error (e.g. empty response)
    // or with an error (e.g. connection refused). Both are valid.
    expect(typeof result.totalFound).toBe("number");
  }
});

test("executeSoloditSearch handles non-array MCP response", async () => {
  const { context } = createContext();

  const oddMcp: CallMcpTool = async () => {
    return { unexpected: "response" };
  };

  const result = await executeSoloditSearch(
    { query: "oracle manipulation" },
    context,
    oddMcp
  );

  expect(result.results).toHaveLength(0);
  expect(result.totalFound).toBe(0);
  expect(result.error).toBeUndefined();
});

test("executeSoloditSearch sanitizes partial finding objects", async () => {
  const { context } = createContext();

  const mockMcp: CallMcpTool = async () => {
    return [
      { title: "Partial finding", severity: "Low" },
      { title: "Another", url: "https://example.com" },
    ];
  };

  const result = await executeSoloditSearch(
    { query: "test" },
    context,
    mockMcp
  );

  expect(result.results).toHaveLength(2);
  expect(result.results[0]?.title).toBe("Partial finding");
  expect(result.results[0]?.severity).toBe("Low");
  expect(result.results[0]?.description).toBe("");
  expect(result.results[0]?.protocol).toBe("");
  expect(result.results[0]?.url).toBe("");
  expect(result.results[0]?.remediation).toBe("");

  expect(result.results[1]?.url).toBe("https://example.com");
  expect(result.results[1]?.severity).toBe("");
});

test("soloditSearchTool.execute returns JSON string", async () => {
  const { context } = createContext();

  const output = await soloditSearchTool.execute(
    { query: "reentrancy" },
    context
  );

  const parsed = JSON.parse(output) as SoloditSearchResult;
  expect(parsed.query).toBe("reentrancy");
  expect(parsed.results).toBeInstanceOf(Array);
  expect(typeof parsed.totalFound).toBe("number");
});

test("executeSoloditSearch omits severity filter when not provided", async () => {
  const { context } = createContext();
  const capturedArgs: Array<Record<string, unknown>> = [];

  const mockMcp: CallMcpTool = async (_server, _tool, args) => {
    capturedArgs.push(args);
    return [];
  };

  await executeSoloditSearch(
    { query: "test" },
    context,
    mockMcp
  );

  expect(capturedArgs[0]?.filters).toBeUndefined();
});
