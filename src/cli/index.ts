#!/usr/bin/env bun
import { createCliProgram } from "./cli-program";

async function main(): Promise<void> {
  const program = createCliProgram();
  const args = Bun.argv.slice(2);
  const exitCode = await program.dispatch(args);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
