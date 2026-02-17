import { test, expect, beforeEach, afterEach } from "bun:test";
import { detectProject } from "./project-detector";
import type { ProjectConfig } from "./project-detector";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-detector-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("detects Foundry project from foundry.toml", async () => {
  const foundryToml = `[profile.default]
src = "src"
test = "test"
solc = "0.8.20"
remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.solcVersion).toBe("0.8.20");
  expect(config.remappings).toContain("@openzeppelin/=lib/openzeppelin-contracts/");
  expect(config.rootDir).toBe(tempDir);
});

test("detects Hardhat project from hardhat.config.ts", async () => {
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("hardhat");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.rootDir).toBe(tempDir);
});

test("detects Hardhat project from hardhat.config.js", async () => {
  writeFileSync(join(tempDir, "hardhat.config.js"), "module.exports = {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("hardhat");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("test");
  expect(config.rootDir).toBe(tempDir);
});

test("detects mixed project when both foundry.toml and hardhat.config exist", async () => {
  writeFileSync(join(tempDir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("mixed");
  expect(config.rootDir).toBe(tempDir);
});

test("returns unknown for empty directory", async () => {
  const config = await detectProject(tempDir);

  expect(config.type).toBe("unknown");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.rootDir).toBe(tempDir);
});

test("parses Foundry foundry.toml with custom src and test dirs", async () => {
  const foundryToml = `[profile.default]
src = "contracts"
test = "tests"
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("contracts");
  expect(config.testDir).toBe("tests");
});

test("parses Foundry foundry.toml with multiple remappings", async () => {
  const foundryToml = `[profile.default]
remappings = [
  "@openzeppelin/=lib/openzeppelin-contracts/",
  "@uniswap/=lib/uniswap-v3-core/"
]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.remappings.length).toBe(2);
  expect(config.remappings).toContain("@openzeppelin/=lib/openzeppelin-contracts/");
  expect(config.remappings).toContain("@uniswap/=lib/uniswap-v3-core/");
});

test("handles Foundry foundry.toml without optional fields", async () => {
  const foundryToml = `[profile.default]
`;
  writeFileSync(join(tempDir, "foundry.toml"), foundryToml);

  const config = await detectProject(tempDir);

  expect(config.type).toBe("foundry");
  expect(config.srcDir).toBe("src");
  expect(config.testDir).toBe("test");
  expect(config.remappings).toEqual([]);
  expect(config.solcVersion).toBeUndefined();
});

test("prioritizes foundry.toml over hardhat.config when both exist", async () => {
  writeFileSync(join(tempDir, "foundry.toml"), "[profile.default]\nsrc = 'src'\n");
  writeFileSync(join(tempDir, "hardhat.config.ts"), "export default {};");

  const config = await detectProject(tempDir);

  expect(config.type).toBe("mixed");
});
