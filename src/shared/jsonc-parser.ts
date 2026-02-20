export function stripJsoncComments(jsonc: string): string {
  // Single-pass stateful scanner that handles both line and block comments
  // while respecting string boundaries (won't corrupt "/* ... */" inside strings)
  let inString = false;
  let escaped = false;
  let inBlockComment = false;
  let inLineComment = false;
  const chars: string[] = [];

  for (let i = 0; i < jsonc.length; i++) {
    const ch = jsonc[i]!;
    const next = jsonc[i + 1];

    // Inside a block comment: skip until closing */
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++; // skip the '/'
      }
      continue;
    }

    // Inside a line comment: skip until end of line
    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        chars.push(ch);
      }
      continue;
    }

    // Handle escape sequences inside strings
    if (escaped) {
      escaped = false;
      chars.push(ch);
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true;
        chars.push(ch);
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      chars.push(ch);
      continue;
    }

    // Outside strings: detect comment starts
    if (ch === '"') {
      inString = true;
      chars.push(ch);
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++; // skip the second '/'
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++; // skip the '*'
      continue;
    }

    chars.push(ch);
  }

  let result = chars.join("");

  // Strip trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, "$1");

  return result;
}
