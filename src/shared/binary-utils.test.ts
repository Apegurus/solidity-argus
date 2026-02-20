import { describe, it, expect } from "bun:test";
import { hasBinary, parseSolcVersion, extractContractNames } from "./binary-utils";

describe("binary-utils", () => {
  describe("hasBinary", () => {
    it("should return true for existing binary (node)", () => {
      const result = hasBinary("node");
      expect(result).toBe(true);
    });

    it("should return false for non-existent binary", () => {
      const result = hasBinary("nonexistent-binary-xyz-12345");
      expect(result).toBe(false);
    });

    it("should return true for bun", () => {
      const result = hasBinary("bun");
      expect(result).toBe(true);
    });
  });

  describe("parseSolcVersion", () => {
    it("should return undefined for non-existent path", () => {
      const result = parseSolcVersion("/nonexistent/path");
      expect(result).toBeUndefined();
    });

    it("should extract version from foundry.toml", () => {
      const testDir = "/tmp/solc-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        testDir + "/foundry.toml",
        'solc = "0.8.19"\nother = "value"'
      );

      const result = parseSolcVersion(testDir);
      expect(result).toBe("0.8.19");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should extract version from pragma in .sol file", () => {
      const testDir = "/tmp/solc-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir + "/src", { recursive: true });
      writeFileSync(
        testDir + "/src/Contract.sol",
        "pragma solidity ^0.8.20;\n\ncontract Test {}"
      );

      const result = parseSolcVersion(testDir);
      expect(result).toBe("0.8.20");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should handle version with caret", () => {
      const testDir = "/tmp/solc-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir + "/src", { recursive: true });
      writeFileSync(
        testDir + "/src/Contract.sol",
        "pragma solidity ^0.8.0;\n\ncontract Test {}"
      );

      const result = parseSolcVersion(testDir);
      expect(result).toBe("0.8.0");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should handle version with tilde", () => {
      const testDir = "/tmp/solc-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir + "/src", { recursive: true });
      writeFileSync(
        testDir + "/src/Contract.sol",
        "pragma solidity ~0.7.6;\n\ncontract Test {}"
      );

      const result = parseSolcVersion(testDir);
      expect(result).toBe("0.7.6");

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe("extractContractNames", () => {
    it("should extract contract names from Solidity file", () => {
      const testDir = "/tmp/contract-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      const filePath = testDir + "/Test.sol";
      writeFileSync(
        filePath,
        `pragma solidity ^0.8.0;

contract MyContract {
  function test() public {}
}

contract AnotherContract {
  function test() public {}
}`
      );

      const result = extractContractNames(filePath);
      expect(result).toContain("MyContract");
      expect(result).toContain("AnotherContract");
      expect(result.length).toBe(2);

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should extract library names", () => {
      const testDir = "/tmp/contract-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      const filePath = testDir + "/Test.sol";
      writeFileSync(
        filePath,
        `pragma solidity ^0.8.0;

library SafeMath {
  function add(uint a, uint b) internal pure returns (uint) {
    return a + b;
  }
}`
      );

      const result = extractContractNames(filePath);
      expect(result).toContain("SafeMath");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should extract interface names", () => {
      const testDir = "/tmp/contract-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      const filePath = testDir + "/Test.sol";
      writeFileSync(
        filePath,
        `pragma solidity ^0.8.0;

interface IERC20 {
  function transfer(address to, uint amount) external returns (bool);
}`
      );

      const result = extractContractNames(filePath);
      expect(result).toContain("IERC20");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should return empty array for non-existent file", () => {
      const result = extractContractNames("/nonexistent/file.sol");
      expect(result).toEqual([]);
    });

    it("should return empty array for file with no contracts", () => {
      const testDir = "/tmp/contract-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      const filePath = testDir + "/Test.sol";
      writeFileSync(filePath, "pragma solidity ^0.8.0;\n\n// Just comments");

      const result = extractContractNames(filePath);
      expect(result).toEqual([]);

      rmSync(testDir, { recursive: true, force: true });
    });

    it("should handle multiple contracts and libraries", () => {
      const testDir = "/tmp/contract-test-" + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = require("fs");

      mkdirSync(testDir, { recursive: true });
      const filePath = testDir + "/Test.sol";
      writeFileSync(
        filePath,
        `pragma solidity ^0.8.0;

contract Token {
  string public name = "MyToken";
}

library Math {
  function sqrt(uint x) internal pure returns (uint) {
    return x;
  }
}

interface IToken {
  function transfer(address to, uint amount) external;
}`
      );

      const result = extractContractNames(filePath);
      expect(result).toContain("Token");
      expect(result).toContain("Math");
      expect(result).toContain("IToken");
      expect(result.length).toBe(3);

      rmSync(testDir, { recursive: true, force: true });
    });
  });
});
