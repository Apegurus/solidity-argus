import type { CliCommand } from "./types";

const HELP_TEXT = `argus — Solidity Security Auditor for OpenCode

Commands:
  doctor   Check Slither/Foundry installation and config health
  init     Create opencode-argus config file
  install  Configure argus plugin in opencode config
`;

export class CliProgram {
  private commands: Map<string, CliCommand> = new Map();

  registerCommand(command: CliCommand): void {
    this.commands.set(command.name, command);
  }

  async dispatch(args: string[]): Promise<number> {
    const subcommand = args[0];

    if (!subcommand || subcommand === "--help" || subcommand === "-h") {
      console.log(HELP_TEXT);
      return 0;
    }

    const command = this.commands.get(subcommand);
    if (!command) {
      console.error(`Error: Unknown command '${subcommand}'. Run 'argus' for help.`);
      return 1;
    }

    return command.execute(args.slice(1));
  }
}

export function createCliProgram(): CliProgram {
  const program = new CliProgram();

  program.registerCommand({
    name: "doctor",
    description: "Check Slither/Foundry installation and config health",
    execute: async () => {
      console.log("argus doctor: not yet implemented");
      return 0;
    },
  });

  program.registerCommand({
    name: "init",
    description: "Create opencode-argus config file",
    execute: async () => {
      console.log("argus init: not yet implemented");
      return 0;
    },
  });

  program.registerCommand({
    name: "install",
    description: "Configure argus plugin in opencode config",
    execute: async () => {
      console.log("argus install: not yet implemented");
      return 0;
    },
  });

  return program;
}
