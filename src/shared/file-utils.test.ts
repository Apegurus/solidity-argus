import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { detectConfigFile, readJsoncFile } from "./file-utils"

describe("file-utils", () => {
  const testDir = `/tmp/argus-test-${Date.now()}`

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("detectConfigFile", () => {
    it("should detect .json config file", () => {
      const configPath = join(testDir, "solidity-argus.json")
      writeFileSync(configPath, '{"key": "value"}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("json")
      expect(result.path).toContain("solidity-argus.json")
    })

    it("should detect .jsonc config file", () => {
      const configPath = join(testDir, "solidity-argus.jsonc")
      writeFileSync(configPath, '{"key": "value" // comment\n}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("jsonc")
      expect(result.path).toContain("solidity-argus.jsonc")
    })

    it("should prefer .jsonc over .json", () => {
      const jsonPath = join(testDir, "solidity-argus.json")
      const jsoncPath = join(testDir, "solidity-argus.jsonc")
      writeFileSync(jsonPath, '{"key": "value"}')
      writeFileSync(jsoncPath, '{"key": "value"}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("jsonc")
    })

    it("should return none when no config file exists", () => {
      const result = detectConfigFile(testDir)
      expect(result.format).toBe("none")
      expect(result.path).toBeNull()
    })

    it("should detect config in .opencode subdirectory", () => {
      const opencodeDir = join(testDir, ".opencode")
      mkdirSync(opencodeDir, { recursive: true })
      const configPath = join(opencodeDir, "solidity-argus.jsonc")
      writeFileSync(configPath, '{"agents": {}}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("jsonc")
      expect(result.path).toContain("solidity-argus.jsonc")
    })

    it("detectConfigFile returns .argus path when .argus config exists", () => {
      const argusDir = join(testDir, ".argus")
      const opencodeDir = join(testDir, ".opencode")
      mkdirSync(argusDir, { recursive: true })
      mkdirSync(opencodeDir, { recursive: true })

      const argusConfigPath = join(argusDir, "solidity-argus.jsonc")
      const opencodeConfigPath = join(opencodeDir, "solidity-argus.jsonc")
      writeFileSync(argusConfigPath, '{"source": "argus"}')
      writeFileSync(opencodeConfigPath, '{"source": "opencode"}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("jsonc")
      expect(result.path).toBe(argusConfigPath)
    })

    it("detectConfigFile falls back to .opencode when .argus is absent", () => {
      const opencodeDir = join(testDir, ".opencode")
      mkdirSync(opencodeDir, { recursive: true })

      const opencodeConfigPath = join(opencodeDir, "solidity-argus.json")
      writeFileSync(opencodeConfigPath, '{"source": "opencode"}')

      const result = detectConfigFile(testDir)
      expect(result.format).toBe("json")
      expect(result.path).toBe(opencodeConfigPath)
    })
  })

  describe("readJsoncFile", () => {
    it("should read and parse valid JSON file", () => {
      const configPath = join(testDir, "config.json")
      const data = { key: "value", number: 42 }
      writeFileSync(configPath, JSON.stringify(data))

      const result = readJsoncFile(configPath)
      expect(result).toEqual(data)
    })

    it("should read and parse JSONC file with comments", () => {
      const configPath = join(testDir, "config.jsonc")
      const content = `{
  // This is a comment
  "key": "value",
  "number": 42
}`
      writeFileSync(configPath, content)

      const result = readJsoncFile(configPath)
      expect(result).toEqual({ key: "value", number: 42 })
    })

    it("should handle JSONC with trailing commas", () => {
      const configPath = join(testDir, "config.jsonc")
      const content = `{
  "key": "value",
  "array": [1, 2, 3,],
}`
      writeFileSync(configPath, content)

      const result = readJsoncFile(configPath)
      expect(result).toEqual({ key: "value", array: [1, 2, 3] })
    })

    it("should return null for non-existent file", () => {
      const result = readJsoncFile(join(testDir, "nonexistent.json"))
      expect(result).toBeNull()
    })

    it("should return null for invalid JSON", () => {
      const configPath = join(testDir, "invalid.json")
      writeFileSync(configPath, "{ invalid json }")

      const result = readJsoncFile(configPath)
      expect(result).toBeNull()
    })

    it("should preserve URLs in strings", () => {
      const configPath = join(testDir, "config.jsonc")
      const content = `{
  "apiUrl": "https://api.example.com/v1", // API endpoint
  "websocketUrl": "wss://ws.example.com"
}`
      writeFileSync(configPath, content)

      const result = readJsoncFile(configPath)
      expect(result?.apiUrl).toBe("https://api.example.com/v1")
      expect(result?.websocketUrl).toBe("wss://ws.example.com")
    })

    it("should handle nested objects", () => {
      const configPath = join(testDir, "config.jsonc")
      const content = `{
  "agents": {
    "argus": {
      "model": "claude-opus-4-6"
    }
  }
}`
      writeFileSync(configPath, content)

      const result = readJsoncFile(configPath)
      const agents = result?.agents as Record<string, Record<string, unknown>> | undefined
      expect(agents?.argus?.model).toBe("claude-opus-4-6")
    })

    it("should handle empty file", () => {
      const configPath = join(testDir, "empty.json")
      writeFileSync(configPath, "")

      const result = readJsoncFile(configPath)
      expect(result).toBeNull()
    })
  })
})
