export const DEFAULT_MODELS = {
  argus: "anthropic/claude-opus-5",
  sentinel: "anthropic/claude-sonnet-5",
  pythia: "openai/gpt-5.6-terra",
  auditSpecialist: "anthropic/claude-sonnet-5",
  scribe: "anthropic/claude-sonnet-4-5",
  themis: "openai/gpt-5.6-sol",
} as const

export const DEFAULT_VARIANTS = {
  argus: "max",
  sentinel: "high",
  pythia: "high",
  auditSpecialist: "xhigh",
  scribe: "high",
  themis: "xhigh",
} as const

export const DEFAULT_STEPS = 50 as const
