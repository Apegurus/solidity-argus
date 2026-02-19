import type { CliCommand } from "./types";
import { doctorCommand } from "./commands/doctor";
import { initCommand } from "./commands/init";
import { installCommand } from "./commands/install";
import { lintSkillsCommand } from "./commands/lint-skills";
import { cliOutput } from "./cli-output";

const HELP_TEXT = `argus — Solidity Security Auditor for OpenCode

Commands:
  doctor       Check Slither/Foundry installation and config health
  init         Create solidity-argus config file
  install      Configure argus plugin in opencode config
  lint-skills  Validate SKILL.md files against schema
`;

export class CliProgram {
  private commands: Map<string, CliCommand> = new Map();

  registerCommand(command: CliCommand): void {
    this.commands.set(command.name, command);
  }

  async dispatch(args: string[]): Promise<number> {
    const subcommand = args[0];

    if (!subcommand || subcommand === "--help" || subcommand === "-h") {
      cliOutput.log(HELP_TEXT);
      return 0;
    }

    const command = this.commands.get(subcommand);
    if (!command) {
      cliOutput.error(`Unknown command '${subcommand}'. Run 'argus' for help.`);
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
  program.registerCommand(lintSkillsCommand);
  return program;
}
