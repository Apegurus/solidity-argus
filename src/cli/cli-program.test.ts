import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CliProgram, createCliProgram } from "./cli-program";
import type { CliCommand } from "./types";
import { cliOutput } from "./cli-output";

describe("CliProgram", () => {
  let program: CliProgram;
  let output: string[];
  let errorOutput: string[];
  let originalLog: typeof cliOutput.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    program = new CliProgram();
    output = [];
    errorOutput = [];

    originalLog = cliOutput.log;
    originalError = console.error;

    cliOutput.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };

    console.error = (...args: unknown[]) => {
      errorOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    cliOutput.log = originalLog;
    console.error = originalError;
  });

  describe("help output", () => {
    it("should show help when no args provided", async () => {
      const exitCode = await program.dispatch([]);
      expect(exitCode).toBe(0);
      expect(output.join("\n")).toContain("argus — Solidity Security Auditor");
      expect(output.join("\n")).toContain("doctor");
      expect(output.join("\n")).toContain("init");
      expect(output.join("\n")).toContain("install");
    });

    it("should show help with --help flag", async () => {
      const exitCode = await program.dispatch(["--help"]);
      expect(exitCode).toBe(0);
      expect(output.join("\n")).toContain("argus — Solidity Security Auditor");
    });

    it("should show help with -h flag", async () => {
      const exitCode = await program.dispatch(["-h"]);
      expect(exitCode).toBe(0);
      expect(output.join("\n")).toContain("argus — Solidity Security Auditor");
    });
  });

  describe("command dispatch", () => {
    it("should dispatch to registered command", async () => {
      let executed = false;
      const testCommand: CliCommand = {
        name: "test",
        description: "Test command",
        execute: async () => {
          executed = true;
          return 0;
        },
      };

      program.registerCommand(testCommand);
      const exitCode = await program.dispatch(["test"]);

      expect(executed).toBe(true);
      expect(exitCode).toBe(0);
    });

    it("should pass remaining args to command", async () => {
      let receivedArgs: string[] = [];
      const testCommand: CliCommand = {
        name: "test",
        description: "Test command",
        execute: async (args) => {
          receivedArgs = args;
          return 0;
        },
      };

      program.registerCommand(testCommand);
      await program.dispatch(["test", "arg1", "arg2"]);

      expect(receivedArgs).toEqual(["arg1", "arg2"]);
    });

    it("should return command exit code", async () => {
      const testCommand: CliCommand = {
        name: "test",
        description: "Test command",
        execute: async () => 42,
      };

      program.registerCommand(testCommand);
      const exitCode = await program.dispatch(["test"]);

      expect(exitCode).toBe(42);
    });
  });

  describe("unknown command", () => {
    it("should error on unknown command", async () => {
      const exitCode = await program.dispatch(["unknown-cmd"]);

      expect(exitCode).toBe(1);
      expect(errorOutput.join("\n")).toContain("Unknown command 'unknown-cmd'");
      expect(errorOutput.join("\n")).toContain("Run 'argus' for help");
    });
  });

  describe("registered commands", () => {
    it("should have doctor command", async () => {
      const program = createCliProgram();
      const exitCode = await program.dispatch(["doctor"]);

      expect(output.join("\n")).toContain("Argus Doctor");
    }, 15_000);

    it("should have init command", async () => {
      const program = createCliProgram();
      const exitCode = await program.dispatch(["init"]);

      const combined = output.join("\n") + errorOutput.join("\n");
      expect(combined).toMatch(/solidity-argus/);
    });

    it("should have install command", async () => {
      const program = createCliProgram();
      const exitCode = await program.dispatch(["install"]);

      const combined = output.join("\n") + errorOutput.join("\n");
      expect(combined).toMatch(/solidity-argus|opencode/);
    });
  });
});
