export {
  type ClusterConfig,
  type ClusterFinding,
  type ClusterResult,
  clusterFindings,
  DEFAULT_CLUSTER_CONFIG,
  type FindingCluster,
} from "./cluster"
export {
  checkExactRegexConflicts,
  DEFAULT_GATE_CONFIG,
  evaluatePair,
  formatReportJson,
  formatReportText,
  type GateConfig,
  type GateLevel,
  type GateVerdict,
  generateReport,
  type SkillReport,
} from "./gates"
export { normalizeSkill, type SkillDoc } from "./normalize"
export {
  buildTfidfCorpus,
  computeAllPairs,
  computeSimilarity,
  detectionRuleOverlap,
  type SimilarityPair,
  type SimilarityScore,
  shingleJaccard,
  type TfidfCorpus,
  tfidfCosine,
  tokenJaccard,
} from "./similarity"
