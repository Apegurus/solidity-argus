export function stripJsoncComments(jsonc: string): string {
  let result = jsonc;

  result = result.replace(/\/\*[\s\S]*?\*\//g, "");

  const lines = result.split("\n");
  result = lines
    .map((line) => {
      let inString = false;
      let escaped = false;
      let lastCommentIndex = -1;

      for (let i = 0; i < line.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (line[i] === "\\") {
          escaped = true;
          continue;
        }
        if (line[i] === '"') {
          inString = !inString;
        }
        if (!inString && line[i] === "/" && line[i + 1] === "/") {
          lastCommentIndex = i;
          break;
        }
      }

      if (lastCommentIndex === -1) return line;
      return line.substring(0, lastCommentIndex);
    })
    .join("\n");

  result = result.replace(/,(\s*[}\]])/g, "$1");

  return result;
}
