/**
 * Shared prompt instructions appended to Sentinel and Pythia prompts.
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

If any gate returns **REJECTED** → drop the candidate. Do NOT call \`argus_record_finding\`.
If any gate returns **DEMOTE** → continue recording, but the finding becomes a Lead.
If all gates return **cleared/confirmed** → the finding is CONFIRMED.

### Fields to set on every recorded finding

- \`description\` (REQUIRED at discipline level — without the trace prefix the finding will be annotated \`⚠️ no rubric trace\` in the report): MUST begin with a Rubric Trace prefix in the exact format from the refutation-rubric skill (see "Rubric Trace Format" section of that skill). The Refutation quote MUST be a real line from the contract under audit, copied verbatim. Fabricated quotes are the single worst failure mode of this discipline.
- \`confidence_score\` (OPTIONAL at the schema level, RECOMMENDED at the discipline level — without it your finding renders without a \`[NN]\` prefix and ranks after all scored findings; with it the finding can land in the Findings or Leads tier per the threshold): integer 0-100 computed per the rubric's deduction rules (start at 100, subtract for partial paths, bounded impact, state requirements; demoted findings cap at 75).
- All existing fields (severity, evidence quality via \`confidence\` enum, file, lines, etc.) — unchanged.

### Forbidden

- Calling \`argus_record_finding\` without first applying all 4 gates.
- Fabricating a Refutation quote that does not appear in the actual contract source.
- Skipping the rubric for "obvious" findings — every finding goes through every gate, no exceptions.
`
