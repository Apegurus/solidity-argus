import { describe, expect, test } from "bun:test"
import { applyAuditSpecialistWatchdogRecovery } from "../../src/create-hooks"
import { createAuditSpecialistWatchdog } from "../../src/hooks/audit-specialist-watchdog"

const repeatedParagraph =
  "LEAD | verdict: REJECTED_DEMOTED | confidence_score: 20 | contract: Vault | function: withdraw | missing_proof: no reachable loss"

describe("audit specialist repetition watchdog", () => {
  test("recovers repeated output into a de-duplicated handoff instead of throwing", async () => {
    const watchdog = createAuditSpecialistWatchdog({
      getAgentForSession: () => "audit-specialist",
    })
    const output = {
      text: [repeatedParagraph, repeatedParagraph, repeatedParagraph].join("\n\n"),
    }

    const recovered = await watchdog(
      { sessionID: "session-1", messageID: "message-1", partID: "part-1" },
      output,
    )

    expect(recovered).toBe(output.text)
    expect(output.text.match(/REJECTED_DEMOTED/g)?.length).toBe(1)
    expect(output.text).toContain("HANDOFF_JSON")
  })

  test("caller path consumes the watchdog return value", () => {
    const output = { text: "stale original" }

    applyAuditSpecialistWatchdogRecovery(output, "recovered handoff")

    expect(output.text).toBe("recovered handoff")
  })
})
