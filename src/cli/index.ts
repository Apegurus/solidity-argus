#!/usr/bin/env bun
import { createCliProgram } from "./cli-program";

const program = createCliProgram();
const args = Bun.argv.slice(2);
const exitCode = await program.dispatch(args);

// Set exit code without process.exit() so stdout flushes before termination
process.exitCode = exitCode;
