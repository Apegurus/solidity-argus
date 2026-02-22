export {
  adaptLegacyFindings,
  adaptLegacyStateToReportInput,
  getMigrationMode,
  type MigrationMode,
  validateStrictCompatibility,
} from "./migration-adapter"

export {
  computeParityMetrics,
  formatParityReport,
  type ParityMetrics,
  type SeverityDistribution,
} from "./parity-telemetry"
