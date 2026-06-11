/**
 * Shared prompt instructions appended to Sentinel, Pythia, and Audit Specialist prompts.
 *
 * Instructs source agents to apply the 4-gate refutation-rubric skill
 * before recording any finding. The text intentionally references the
 * `refutation-rubric` skill by name — the agent must load it explicitly
 * via `argus_skill_load` at audit start.
 *
 * See: skills/methodology/refutation-rubric/SKILL.md
 * See: docs/superpowers/specs/2026-05-16-findings-rubric-and-self-update-design.md §5.2
 */
export const REFUTATION_RUBRIC_INSTRUCTIONS = `
## Refutation Rubric (REQUIRED)

At the start of every audit, before any analysis work, you MUST call:

  argus_skill_load({ name: "refutation-rubric" })

Load and read the full content. This is non-negotiable. Without the rubric loaded, your finding output is considered un-validated.

### Before every \`argus_record_finding\` call

Walk all 4 gates from the rubric explicitly in your reasoning:

1. **Refutation** — find and quote the exact line of code that does or does not block the attack.
2. **Reachability** — prove the vulnerable state is reachable in deployment.
3. **Trigger** — prove an unprivileged actor can trigger it profitably.
4. **Impact** — prove material harm to an identifiable victim.

Assign exactly one \`rubric_verdict\` per finding:

- If all gates clear → \`rubric_verdict="CONFIRMED"\`, \`confidence_score ≥ 80\`, lands in \`## Findings\`.
- If any gate returns **DEMOTE** but no gate fails outright → \`rubric_verdict="DEMOTED"\`, \`confidence_score ≤ 75\`, lands in \`## Leads\`.
- If any gate would have been **REJECTED**, OR the candidate matches a Safe Pattern, OR it falls into the Audit Noise list → \`rubric_verdict="REJECTED_DEMOTED"\`, \`confidence_score ≤ 30\`, lands at the bottom of \`## Leads\`.

**You never drop a candidate.** Even findings you are highly confident are not exploitable get recorded with REJECTED_DEMOTED so the reviewer can audit your reasoning. Dropping is forbidden because argus users may not have a human auditor to backfill the missed reasoning.

### Fields to set on every recorded finding

- \`description\` (REQUIRED at discipline level — without the trace prefix the finding will be annotated \`⚠️ no rubric trace\` in the report): MUST begin with a Rubric Trace prefix in the exact format from the refutation-rubric skill (see "Rubric Trace Format" section of that skill). The Verdict in the trace header MUST match the structured \`rubric_verdict\` field below. The Refutation quote MUST be a real line from the contract under audit, copied verbatim. Fabricated quotes are the single worst failure mode of this discipline — a REJECTED_DEMOTED finding with a fabricated quote is worse than nothing because the reader trusts what looks like evidence of a guard.
- \`rubric_verdict\` (REQUIRED at the discipline level, OPTIONAL at the schema level): one of \`"CONFIRMED" | "DEMOTED" | "REJECTED_DEMOTED"\`. Set per the routing rules above.
- \`confidence_score\` (REQUIRED at the discipline level, OPTIONAL at the schema level): integer 0-100 computed per the rubric's deduction rules (start at 100, subtract for partial paths, bounded impact, state requirements; DEMOTED caps at 75; REJECTED_DEMOTED caps at 30). Without it your finding renders without a \`[NN]\` prefix and ranks after all scored findings.
- All existing fields (severity, evidence quality via \`confidence\` enum, file, lines, etc.) — unchanged.

### Forbidden

- Calling \`argus_record_finding\` without first applying all 4 gates.
- Fabricating a Refutation quote that does not appear in the actual contract source.
- Skipping the rubric for "obvious" findings — every finding goes through every gate, no exceptions.
- Dropping a candidate. There is no drop verdict. The lowest verdict is REJECTED_DEMOTED at confidence ≤ 30, which still records the finding.
`
