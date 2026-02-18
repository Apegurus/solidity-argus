import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createLogger } from "./logger";

describe("logger", () => {
  let consoleErrorSpy: (message?: any, ...optionalParams: any[]) => void;
  let capturedOutput: string[] = [];

  beforeEach(() => {
    capturedOutput = [];
    consoleErrorSpy = console.error;
    console.error = (...args: any[]) => {
      capturedOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.error = consoleErrorSpy;
  });

  it("should output to stderr with [argus] prefix", () => {
    const logger = createLogger({ debug: false });
    logger.info("test message");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("test message");
  });

  it("should not output debug messages when debug=false", () => {
    const logger = createLogger({ debug: false });
    logger.debug("debug message");

    expect(capturedOutput.length).toBe(0);
  });

  it("should output debug messages when debug=true", () => {
    const logger = createLogger({ debug: true });
    logger.debug("debug message");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("debug message");
  });

  it("should output info messages regardless of debug flag", () => {
    const logger = createLogger({ debug: false });
    logger.info("info message");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("info message");
  });

  it("should output error messages with [argus] prefix", () => {
    const logger = createLogger({ debug: false });
    logger.error("error message");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("error message");
  });

  it("should output warn messages with [argus] prefix", () => {
    const logger = createLogger({ debug: false });
    logger.warn("warn message");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("warn message");
  });

  it("should handle multiple arguments", () => {
    const logger = createLogger({ debug: false });
    logger.info("message", "with", "multiple", "args");

    expect(capturedOutput.length).toBe(1);
    expect(capturedOutput[0]).toContain("[argus]");
    expect(capturedOutput[0]).toContain("message");
    expect(capturedOutput[0]).toContain("with");
  });
});
