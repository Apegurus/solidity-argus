import { describe, it, expect } from "bun:test";
import { stripJsoncComments } from "./jsonc-parser";

describe("stripJsoncComments", () => {
  it("should strip line comments", () => {
    const input = `{
  "key": "value" // this is a comment
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"key": "value"');
    expect(result).not.toContain("// this is a comment");
  });

  it("should strip block comments", () => {
    const input = `{
  /* this is a block comment */
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"key": "value"');
    expect(result).not.toContain("/* this is a block comment */");
  });

  it("should preserve // inside strings", () => {
    const input = `{
  "url": "http://example.com",
  "path": "//network/share"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain("http://example.com");
    expect(result).toContain("//network/share");
  });

  it("should strip trailing commas", () => {
    const input = `{
  "key1": "value1",
  "key2": "value2",
}`;
    const result = stripJsoncComments(input);
    expect(result).not.toContain('",\n}');
  });

  it("should handle escaped quotes in strings", () => {
    const input = `{
  "escaped": "value with \\"quote\\"" // comment
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('value with \\"quote\\"');
    expect(result).not.toContain("// comment");
  });

  it("should not strip // in middle of string", () => {
    const input = `{
  "protocol": "https://api.example.com/v1"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain("https://api.example.com/v1");
  });

  it("should handle multiple line comments", () => {
    const input = `{
  "key1": "value1", // comment 1
  "key2": "value2"  // comment 2
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"key1": "value1"');
    expect(result).toContain('"key2": "value2"');
    expect(result).not.toContain("// comment");
  });

  it("should handle nested block comments", () => {
    const input = `{
  /* outer /* inner */ outer */
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"key": "value"');
    expect(result).not.toContain("outer */");
  });

  it("should preserve /* */ sequences inside strings", () => {
    const input = `{
  "pattern": "/* not a comment */",
  "note": "ok"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"pattern": "/* not a comment */"');
    const parsed = JSON.parse(result);
    expect(parsed.pattern).toBe("/* not a comment */");
  });

  it("should handle empty input", () => {
    const input = "";
    const result = stripJsoncComments(input);
    expect(result).toBe("");
  });

  it("should handle only comments", () => {
    const input = `// just a comment
/* block comment */`;
    const result = stripJsoncComments(input);
    expect(result.trim()).toBe("");
  });

  it("should preserve strings with escaped backslashes", () => {
    const input = `{
  "path": "C:\\\\Users\\\\file.txt" // windows path
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain("C:\\\\Users\\\\file.txt");
    expect(result).not.toContain("// windows path");
  });

  it("should handle complex real-world JSONC", () => {
    const input = `{
  // Configuration file
  "agents": {
    "argus": {
      "model": "claude-opus-4-6", // main orchestrator
      "tools": ["slither", "forge"] // available tools
    }
  },
  /* End of config */
  "enabled": true,
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain('"model": "claude-opus-4-6"');
    expect(result).toContain('"tools": ["slither", "forge"]');
    expect(result).not.toContain("//");
    expect(result).not.toContain("/*");
  });

  it("should handle URL with protocol in string", () => {
    const input = `{
  "apiUrl": "https://api.scvd.dev/v1" // SCVD API endpoint
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain("https://api.scvd.dev/v1");
    expect(result).not.toContain("// SCVD API endpoint");
  });

  it("should preserve block comment syntax inside strings", () => {
    const input = `{
  "pattern": "/* this is not a comment */",
  "key": "value"
}`;
    const result = stripJsoncComments(input);
    expect(result).toContain("/* this is not a comment */");
    expect(result).toContain('"key": "value"');
  });

  it("should preserve mixed comment syntax inside strings", () => {
    const input = `{
  "regex": "^/\\\\*.*\\\\*/$",
  "note": "handles /* and // patterns"
}`;
    const result = stripJsoncComments(input);
    const parsed = JSON.parse(result);
    expect(parsed.regex).toBeDefined();
    expect(parsed.note).toContain("/*");
    expect(parsed.note).toContain("//");
  });

  it("should not strip structural-looking commas inside strings", () => {
    const input = `{
  "literal": ",}",
  "arrayLiteral": ", ]",
  "value": 1,
}`;
    const result = stripJsoncComments(input);
    const parsed = JSON.parse(result);
    expect(parsed.literal).toBe(",}");
    expect(parsed.arrayLiteral).toBe(", ]");
    expect(parsed.value).toBe(1);
  });
});
