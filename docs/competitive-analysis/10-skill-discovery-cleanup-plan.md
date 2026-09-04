# Skill Discovery & Skill-Quality Cleanup Plan

Date: 2026-06-19  
Base: `staging@48b5ce9`  
Branch/worktree: `feat/skill-discovery-cleanup` at `.worktrees/skill-discovery-cleanup`

## Goal

Prepare a focused cleanup that separates **knowledge discovery** from **regex scanning**, fixes the PR #25 skill-content issues we reviewed, and preserves the v0.7.1 scoping guarantee: Argus skills must not be globally injected into non-Argus agents.

## Current model

Argus currently has two knowledge paths:

1. `argus_skill_load(name)` loads one full skill by exact/normalized name.
   - Backed by `resolveArgusSkills()`.
   - Already has names, descriptions, source, path, content, and provenance metadata.
   - Resolver roots today are bundled skills, `knowledge.customSkillsDir`, Trail of Bits cached companion skills, project/global OpenCode skills, and project/global Claude skills.
   - The resolver returns effective winners only: first matching normalized name wins according to root order/precedence; shadowed duplicates are not loadable through `argus_skill_load`.
   - Missing: an intentional catalog/search/recommendation surface.
2. `argus_check_patterns(target, patterns, include_scvd)` extracts `detection_rules` only from skills with `pattern_category`.
   - Current implementation scans bundled `skills/` only.
   - Good for deterministic regex hints.
   - Not a skill-discovery mechanism.
   - Broad protocol guides with `pattern_category` can create noisy, mislabeled scan results.

Important scoping guarantee:

- `src/hooks/config-handler.ts` intentionally does **not** register Argus skills in OpenCode global `config.skills.paths`.
- New discovery must stay inside Argus tools and must not inject all Argus skill descriptions into non-Argus agents.

## Decisions from review

- Rewards/credits should favor the user **as long as solvency/invariants are not broken**; dust should be tracked or explicitly documented, not silently kept by the protocol.
- Add agent-facing skill discovery instead of reintroducing global OpenCode skill paths.
- Ship both `argus_list_skills` and `argus_recommend_skills`.
- Discovery tools must use the same resolver roots as `argus_skill_load`: bundled, custom, Trail of Bits cache, OpenCode project/global, and Claude project/global skills.
- Discovery tools return metadata only. Full skill bodies remain available only through `argus_skill_load`.
- Discovery results should show effective winners only, matching what `argus_skill_load` can load. Shadowed duplicate reporting can be a later diagnostic mode if needed.
- Grant Argus direct permission to the new discovery tools while keeping heavyweight audit tools delegated. Also grant the tools to Sentinel, Pythia, Audit Specialist, and Themis. Do not grant them to Scribe unless a later report-quality use case needs it.
- Expand `argus_check_patterns` to scan all resolver roots, not bundled skills only, while preserving strict `pattern_category + detection_rules` gating.
- Keep `argus_check_patterns` strict: it should scan only rules intended for deterministic matching.
- Do not require all skills to have `pattern_category`; require `category` for bundled skills, and reserve `pattern_category` for scanned rules.
- For broad protocol skills that currently carry noisy scanned rules, split high-signal rules into dedicated vulnerability-pattern skills where practical. For any broad protocol rules that remain scanned, lower severity/confidence to match their hint quality.
- Remove unresolved citations, provenance noise, and `(extended)` heading artifacts.
- Move `source_license: "Reference"` usage out of metadata. Put citation-only sources in `## References`; keep `source_license` for actual source/prose licensing.
- Corpus impact is moderate: not a release blocker by itself, but add targeted fixtures for the highest-noise new rules.

## Proposed implementation

### 1. Skill catalog/discovery tools

Add two lightweight tools that expose **metadata only**, never full skill bodies:

```ts
argus_list_skills({
  query?: string,
  category?: string,
  pattern_category?: string,
  source?: "bundled" | "custom" | "trailofbits" | "opencode" | "claude",
  scanned_by_patterns?: boolean,
  limit?: number,
})
```

Behavior:

- With no args: return compact taxonomy/counts plus representative skill names.
- With filters: return rows `{ name, category, pattern_category?, description, source, path, has_detection_rules, scanned_by_patterns }`.
- With `query`: search name, description, category, source, and path; return concise ranked rows.
- Use effective winners from the shared resolver/catalog helper so listed skills are exactly the skills `argus_skill_load` can load.
- Do not include `content` or any body excerpt in the result.

Second tool:

```ts
argus_recommend_skills({ context: string, limit?: number })
```

Behavior:

- Takes short code/protocol context: imports, filenames, contract profile summary, user scope.
- Returns ranked skill candidates with reasons and the same metadata-only row shape as `argus_list_skills`.
- Ranking should be deterministic and explainable: score against skill name, description, category, path, `pattern_category`, and lightweight Solidity/protocol keywords from the context.
- Does not load full bodies; agents still call `argus_skill_load` for selected skills.

Implementation notes:

- Add a shared resolver/catalog helper rather than implementing discovery from the bundled `skills/` directory directly.
- Extend `ResolvedSkill` or create a companion `ResolvedSkillMetadata` shape that includes `category`, `pattern_category`, `has_detection_rules`, and `scanned_by_patterns` without forcing callers to expose `content`.
- Keep resolver/source precedence unchanged for load/discovery. The only planned scanner behavior change is using all resolver roots.
- Tool registration count changes: expect 18 tools when Solodit is enabled and 17 when disabled.

Prompt updates:

- Argus/Sentinel/Pythia/Audit Specialist/Themis: when unsure, list/recommend first, then load exact skills.
- Argus can call only the new discovery tools directly; it still delegates heavyweight audit execution.
- Keep `argus_check_patterns` described as regex scanning only, not discovery.

### 2. Skill content cleanup

Apply the reviewed fixes:

- `lack-of-precision`: rewrite rounding guidance so rewards/credits favor users unless solvency breaks; align table/prose/remediation.
- `pyth-oracle-validation`: add `p.price > 0` before unsigned casts in examples; soften “same transaction” wording to “fresh update exists; same-tx is common for price-sensitive paths.”
- `arbitrary-external-call`: broaden selector regex to catch `.call(abi.encodeWithSelector(...))`; clarify Critical severity requires contract-held funds/approvals/privilege or missing allowlists.
- Remove `(extended)` from headings.
- Resolve or remove `[Dacian]`, `[beirao]`, `[Decurity]`, and other dangling inline markers.
- Move `flash-loan-attacks` new content before `## References`.
- Normalize source metadata where `Reference` is used: move citation-only sources to `## References` and keep `source_license` for actual source/prose licensing.

### 3. Pattern-scanning policy cleanup

- Review protocol-pattern skills with `pattern_category`.
- Expand scanner loading from bundled `skills/` to all resolver/catalog roots.
- Keep the scanner gate strict: a rule is scanned only when a skill has both `pattern_category` and `detection_rules`.
- Prefer splitting high-signal protocol rules into dedicated vulnerability-pattern skills when the rule is precise enough to justify scanning.
- If a broad protocol rule remains in a protocol-pattern skill, lower severity/confidence so scanner output reads as a hint, not a confirmed vulnerability.
- Do **not** make `pattern_category` mandatory for all skills.
- Make `category` mandatory for bundled skills. Current branch has 41 bundled `SKILL.md` files missing `category`; this cleanup should add them.
- Add lint/schema language documenting:
  - `category` = catalog/routing taxonomy.
  - `pattern_category` = deterministic scanner taxonomy.
  - `detection_rules` without `pattern_category` are advisory/non-scanned unless we introduce an explicit `detection_mode`.
  - `scanned_by_patterns` in catalog output means `pattern_category` and non-empty `detection_rules` are present on the effective skill.

### 4. Targeted corpus coverage

Add fixtures only for highest-noise/high-severity new rules, not every rule immediately:

- Pyth positive/negative: unsafe read vs safe `getPriceNoOlderThan` + positive price/conf handling.
- Arbitrary external call: vulnerable `.call(abi.encodeWithSelector(...))` vs allowlisted target+selector pair.
- Concentrated liquidity: unsafe `slot0` value decision vs view/helper-only `slot0` read if any `slot0` rule remains scanned.
- LST/restaking token-symbol rule only if it remains scanned after severity/confidence cleanup; otherwise no corpus needed.

## Suggested work packages / commit boundaries

1. `feat(skills): add Argus skill catalog discovery`
   - shared resolver/catalog metadata helper over all resolver roots
   - `argus_list_skills` and `argus_recommend_skills`
   - tool registration and tests
   - Argus + Sentinel/Pythia/Audit Specialist/Themis permissions

2. `docs(prompts): separate skill discovery from pattern scanning`
   - Argus/Sentinel/Pythia/Audit Specialist/Themis prompt updates
   - README/tool docs and tool-count docs

3. `fix(skills): clean DeFi-depth skill guidance`
   - rounding/Pyth/external-call/headings/citations/source cleanup
   - add missing bundled `category` metadata

4. `feat(patterns): scan all resolver-root detection rules`
   - pattern loader uses shared resolver/catalog roots
   - still requires `pattern_category + detection_rules`
   - tests for custom/OpenCode/Claude/Trail-of-Bits-like fixture roots

5. `test(patterns): add targeted corpus coverage for new detectors`
   - only for rules that remain scanned after split/lower-severity decisions

## Validation plan

- `bun run cli lint-skills`
- `bun test src/tools/argus-skill-load-tool.test.ts src/create-tools.test.ts src/plugin-interface.test.ts src/skills/argus-skill-resolver.test.ts`
- New catalog/discovery tool tests:
  - metadata-only output; no full body leakage
  - filters by `query`, `category`, `pattern_category`, `source`, and `scanned_by_patterns`
  - deterministic recommendation ranking with reasons
  - effective-winner behavior for duplicate skill names
- Permission/config tests for Argus direct discovery access and no global `config.skills.paths` regression
- Pattern-loader tests for all resolver roots and strict `pattern_category + detection_rules` gating
- Pattern-loader/corpus tests for any changed `detection_rules`
- Full `bun test`
- `bunx tsc --noEmit`
- `bunx biome check .`

## Remaining blockers / unknowns

- None known after the 2026-06-19 decision pass.
- Implementation may still discover normal engineering issues, but the product decisions are resolved: two discovery tools, all resolver roots for discovery and scanning, Argus direct discovery permission, bundled-only `category` requirement, split/lower noisy protocol rules, and citation cleanup via References.

## Implementation status

Implemented on this branch after owner confirmation. The branch now includes metadata-only skill discovery tools, resolver-root pattern scanning, updated permissions/prompts/docs, bundled category metadata, and the targeted skill-content cleanup described above. Broad protocol guides with noisy rules are advisory-only unless they carry `pattern_category`; precise vulnerability-pattern rules retain scanner coverage with targeted corpus fixtures.
