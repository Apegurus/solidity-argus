import type { CliCommand } from "./types";
import { doctorCommand } from "./commands/doctor";
import { initCommand } from "./commands/init";
import { installCommand } from "./commands/install";

const HELP_TEXT = `argus — Solidity Security Auditor for OpenCode

Commands:
  doctor   Check Slither/Foundry installation and config health
  init     Create solidity-argus config file
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
  program.registerCommand(doctorCommand);
  program.registerCommand(initCommand);
  program.registerCommand(installCommand);
  return program;
}
