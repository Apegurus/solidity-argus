import type { Plugin } from "@opencode-ai/plugin"

const ArgusPlugin: Plugin = async (_ctx) => {
  return {
    tool: {},
    config: async (_config) => {},
  }
}

export default ArgusPlugin
