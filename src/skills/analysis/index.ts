export { normalizeSkill, type SkillDoc } from "./normalize"
export {
  computeSimilarity,
  computeAllPairs,
  buildTfidfCorpus,
  tokenJaccard,
  shingleJaccard,
  tfidfCosine,
  detectionRuleOverlap,
  type SimilarityScore,
  type SimilarityPair,
  type TfidfCorpus,
} from "./similarity"
export {
  evaluatePair,
  checkExactRegexConflicts,
  generateReport,
  formatReportText,
  formatReportJson,
  DEFAULT_GATE_CONFIG,
  type GateLevel,
  type GateVerdict,
  type GateConfig,
  type SkillReport,
} from "./gates"
export {
  clusterFindings,
  DEFAULT_CLUSTER_CONFIG,
  type ClusterFinding,
  type FindingCluster,
  type ClusterConfig,
  type ClusterResult,
} from "./cluster"
