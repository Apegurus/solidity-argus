/**
 * CLI Command interface
 * Defines the contract for all CLI subcommands
 */
export interface CliCommand {
  name: string;
  description: string;
  execute: (args: string[]) => Promise<number>;
}
