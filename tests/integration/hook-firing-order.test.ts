import { describe, expect, it } from "bun:test"
import type { Hooks, ToolContext } from "@opencode-ai/plugin"

type ChatParamsHook = NonNullable<Hooks["chat.params"]>
type ChatParamsInput = Parameters<ChatParamsHook>[0]
type SystemTransformHook = NonNullable<Hooks["experimental.chat.system.transform"]>
type SystemTransformInput = Parameters<SystemTransformHook>[0]

type IsRequiredKey<T, K extends keyof T> = {} extends Pick<T, K> ? false : true
type IsOptionalKey<T, K extends keyof T> = {} extends Pick<T, K> ? true : false
type AssertTrue<T extends true> = T

const typeAssertions = {
  chatParamsAgentRequired: true as AssertTrue<IsRequiredKey<ChatParamsInput, "agent">>,
  systemTransformSessionIdOptional: true as AssertTrue<
    IsOptionalKey<SystemTransformInput, "sessionID">
  >,
  toolContextAgentRequired: true as AssertTrue<IsRequiredKey<ToolContext, "agent">>,
}

type HookEvent = { hookName: string; timestamp: number }

function createMockHookSetup() {
  const sessionToAgent = new Map<string, string>()
  const events: HookEvent[] = []

  const record = (hookName: string) => {
    events.push({ hookName, timestamp: Date.now() })
  }

  const hooks: Pick<Hooks, "chat.params" | "experimental.chat.system.transform"> = {
    "chat.params": async (input) => {
      record("chat.params")
      sessionToAgent.set(input.sessionID, input.agent)
    },
    "experimental.chat.system.transform": async (input, output) => {
      record("experimental.chat.system.transform")
      const agent = input.sessionID ? sessionToAgent.get(input.sessionID) : undefined

      if (agent) {
        output.system.push(`argus-context:${agent}`)
        return
      }

      // Fallback strategy if lifecycle order differs from expectation:
      // inject generic Argus context (no agent-specific scoping) and refine on next chat.params.
      output.system.push("argus-context:generic")
    },
  }

  return { hooks, events, sessionToAgent }
}

function makeChatParamsInput(overrides: Partial<ChatParamsInput> = {}): ChatParamsInput {
  return {
    sessionID: "session-1",
    agent: "argus",
    model: {} as ChatParamsInput["model"],
    provider: {} as ChatParamsInput["provider"],
    message: {} as ChatParamsInput["message"],
    ...overrides,
  }
}

describe("OpenCode hook firing order assumptions", () => {
  it("validates expected hook type signatures", () => {
    expect(typeAssertions.chatParamsAgentRequired).toBe(true)
    expect(typeAssertions.systemTransformSessionIdOptional).toBe(true)
  })

  it("documents session -> agent flow when chat.params fires first", async () => {
    const { hooks, events, sessionToAgent } = createMockHookSetup()
    const systemOutput = { system: [] as string[] }

    // This test assumes chat.params fires before system.transform per OpenCode hook lifecycle.
    await hooks["chat.params"]?.(makeChatParamsInput(), {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {},
    })
    await hooks["experimental.chat.system.transform"]?.(
      {
        sessionID: "session-1",
        model: {} as SystemTransformInput["model"],
      },
      systemOutput
    )

    expect(events.map((event) => event.hookName)).toEqual([
      "chat.params",
      "experimental.chat.system.transform",
    ])
    expect(sessionToAgent.get("session-1")).toBe("argus")
    expect(systemOutput.system).toContain("argus-context:argus")
  })

  it("falls back to generic context if system.transform runs first", async () => {
    const { hooks } = createMockHookSetup()
    const firstSystemOutput = { system: [] as string[] }

    await hooks["experimental.chat.system.transform"]?.(
      {
        sessionID: "session-unknown",
        model: {} as SystemTransformInput["model"],
      },
      firstSystemOutput
    )

    expect(firstSystemOutput.system).toEqual(["argus-context:generic"])
  })

  it("validates ToolContext includes context.agent", () => {
    const context: ToolContext = {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "sentinel",
      directory: "/tmp/project",
      worktree: "/tmp/project",
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    }

    expect(typeAssertions.toolContextAgentRequired).toBe(true)
    expect(context.agent).toBe("sentinel")
  })
})
