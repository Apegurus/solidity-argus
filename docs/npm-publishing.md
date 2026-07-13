# npm Publishing Runbook

Operator guide for the two-channel npm release pipeline: `dev` (staging) and `latest` (main).

> **Stop before merging.** The `publish.yml` workflow must not be merged into staging until both
> prerequisites below are complete. A merge without them causes every push to fail with a 403 from
> the npm registry, and there is no graceful fallback.

---

## Prerequisites (complete before merging)

### 1. npm Trusted Publisher

Trusted Publishing lets the workflow authenticate to npm via OIDC — no token stored anywhere.

Go to **npmjs.com > solidity-argus > Settings > Publishing > Trusted Publishers > Add publisher** and fill in:

| Field | Value |
|---|---|
| Owner | `Apegurus` |
| Repository | `solidity-argus` |
| Workflow | `publish.yml` |
| Environment | *(leave blank)* |
| Allowed actions | **`npm publish`** (not "stage publish") |

The workflow filename must match exactly — `publish.yml`, not `publish.yaml` or `release.yml`.
The **Allowed actions** field controls which npm CLI operations the OIDC token may perform.
Select `npm publish` only; do not grant `npm publish --tag` or stage-publish permissions
beyond what the workflow requires.

Verify the entry appears in the Trusted Publishers list before continuing.

### 2. GitHub branch protections

Neither `main` nor `staging` has branch protection today. Without it, a direct push triggers CI and the publish workflow just as a merged PR would, but bypasses the PR review and required-merge policy — so a push with failing checks or without peer review can still land and publish.

Go to **github.com/Apegurus/solidity-argus > Settings > Branches > Add rule** and create two rules:

**For `main`:**
- Branch name pattern: `main`
- Require a pull request before merging: on
- Require status checks to pass before merging: on
  - Required checks: `Lint & Format`, `Typecheck`, `Test`, `E2E Tests`, `Production Readiness`
- Require branches to be up to date before merging: on
- Do not allow bypassing the above settings: on

**For `staging`:**
- Branch name pattern: `staging`
- Require a pull request before merging: on
- Require status checks to pass before merging: on
  - Required checks: `Lint & Format`, `Typecheck`, `Test`, `E2E Tests`, `Production Readiness`
- Do not allow bypassing the above settings: on

Verify with:

```bash
gh api repos/Apegurus/solidity-argus/branches/main/protection \
  --jq '{required_status_checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled}'

gh api repos/Apegurus/solidity-argus/branches/staging/protection \
  --jq '{required_status_checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled}'
```

Interpret the response carefully — there are two distinct failure states:

- **HTTP 404** → no branch protection rule exists at all. The branch is completely unprotected.
- **HTTP 200 with `required_status_checks.contexts: []`** → a protection rule exists but has no
  required checks configured. This is an **unsafe incomplete rule**: PRs can merge without any
  CI passing. It looks protected but provides no quality gate.

Both states must be fixed before merging. The target response for each branch is HTTP 200 with
all five check names present in `contexts`.

---

## Why direct pushes are dangerous

The publish workflow triggers on every push to `staging` or `main` — including direct pushes.
CI runs and the publish job fires regardless of whether the push came through a PR or directly
to the branch. Without branch protection, the missing gate is not CI itself but the **PR review
and required-merge policy**:

- A direct push **does** trigger CI and the publish workflow, but it bypasses the requirement
  for a pull request, peer review, and all required status checks to pass before the ref
  advances. If any check fails, the push has already landed and the publish job has already
  started.
- Only committed, pushed content reaches the GitHub-hosted runner — local uncommitted files
  never make it into the checkout. The clean-check step (`git status --porcelain`) runs
  *after* the release gates and *before* packing; it guards against files mutated or generated
  during the gates themselves (e.g., a script that writes a generated file), not against local
  workspace state. If any such mutation is detected the workflow fails before a tarball is
  produced.
- There is no second pair of eyes before the package lands in the registry.

Once published, a version cannot be overwritten. You can move dist-tags, but the tarball is
permanent. Branch protection enforces the PR + required-checks gate so that no ref can advance
— and no publish can fire — until all checks have passed on a reviewed PR.

---

## Channel and version contract

| Branch | npm dist-tag | Version format | Example |
|---|---|---|---|
| `staging` | `dev` | `<package-version>-dev.<run-id>.g<7-char-sha>` | `0.8.0-dev.12345678.gabc1234` |
| `main` | `latest` | exact `package.json` version | `0.8.0` |

The staging version is unique per run. Two pushes of the same commit produce different versions because the run ID differs. This is intentional: every staging publish is immutable and traceable to a specific CI run.

### Installing by channel

```bash
# Latest stable
npm install solidity-argus
# or explicitly
npm install solidity-argus@latest

# Latest staging build
npm install solidity-argus@dev

# Exact staging version (pin to a specific build)
npm install solidity-argus@0.8.0-dev.12345678.gabc1234

# Exact stable version
npm install solidity-argus@0.8.0
```

Users on `@latest` never see staging builds. The `dev` tag is a moving pointer; `@latest` is a moving pointer too, but only advances on main merges.

---

## First staging publish: verification walkthrough

After merging this feature branch into staging (with prerequisites complete), the publish workflow runs automatically. Follow these steps to confirm it worked.

### Step 1: Watch the run

```bash
gh run list --repo Apegurus/solidity-argus --workflow publish.yml --limit 5
```

Wait for status `completed`. Then inspect the run:

```bash
gh run view <run-id> --repo Apegurus/solidity-argus --log
```

Look for the `npm publish` step. It should print the published version and end with `+ solidity-argus@0.8.0-dev.<run-id>.g<sha>`.

### Step 2: Confirm the registry received it

```bash
npm view solidity-argus dist-tags
```

Expected output includes `dev: '0.8.0-dev.<run-id>.g<sha>'`. If `dev` is absent, the publish step failed silently or the Trusted Publisher was not configured.

```bash
npm view solidity-argus@dev version
```

Should print the exact prerelease version string.

### Step 3: Check provenance

`dist.signatures` in npm registry metadata is a **registry signature** — it proves the tarball
was not tampered with after upload, but it does not prove where or how the package was built.
Provenance is a separate, stronger claim: a signed SLSA attestation linking the tarball to a
specific GitHub Actions run and commit.

**Check registry signature (integrity only):**

```bash
npm view solidity-argus@dev --json | python3 -c "
import sys, json
d = json.load(sys.stdin)
dist = d.get('dist', {})
print('tarball:    ', dist.get('tarball'))
print('integrity:  ', dist.get('integrity'))
print('signatures: ', dist.get('signatures', []))
"
```

A non-empty `signatures` array confirms the tarball is registry-signed. This is present on
all modern npm publishes and does not require `--provenance`.

**Check provenance attestation (build origin):**

```bash
# Verify the installed package's attestations (requires npm >=10.2)
npm audit signatures
```

For a provenance-enabled publish, `npm audit signatures` reports:
```
audited 1 package in Xs
1 package has a verified attestation
```

If it reports `0 packages have a verified attestation`, provenance was not attached — confirm
the workflow step uses `--provenance` and that `id-token: write` permission is granted.

You can also inspect the raw attestation URL from registry metadata:

```bash
npm view solidity-argus@dev --json | python3 -c "
import sys, json
d = json.load(sys.stdin)
att = d.get('dist', {}).get('attestations', {})
print('attestations url:', att.get('url', 'not present'))
print('attestations type:', att.get('type', 'not present'))
"
```

A provenance-enabled publish populates `dist.attestations.url` with a link to the Sigstore
bundle. If the field is absent, provenance was not recorded.

### Step 4: Inspect the tarball

```bash
# Download and list contents without installing
npm pack solidity-argus@dev --dry-run 2>/dev/null || \
  curl -sL "$(npm view solidity-argus@dev dist.tarball)" | tar -tzf - | head -40
```

Confirm the file list includes `src/index.ts`, `skills/`, and `package.json`. No `.env`, no `.argus/sessions/`, no test fixtures.

### Step 5: Check build info

Build info is embedded in the tarball as `package/build-info.json`, not in npm registry metadata.
Extract and validate it directly from the published tarball:

```bash
curl -sL "$(npm view solidity-argus@dev dist.tarball)" \
  | tar -xzf - --to-stdout package/build-info.json 2>/dev/null \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('version:', d.get('version'))
print('commit: ', d.get('commit'))
print('dirty:  ', d.get('dirty'))
"
```

Expected output:
- `version` matches the published version string (e.g., `0.8.0-dev.<run-id>.g<sha>`)
- `commit` is the **full 40-character commit SHA**; its first 7 characters must match the
  `<sha>` suffix in the version string (e.g., version suffix `gabc1234` → commit starts with
  `abc1234`)
- `dirty: False` — the workflow stamps `--dirty false` explicitly after the clean-check gate
  passes; a `true` value here means the stamping step was bypassed or the workflow was modified

If the file is absent from the tarball, the build-info stamping step in the workflow failed.
Check the workflow log for the `stamp-build-info` step.

---

## Workflow architecture

`publish.yml` uses a **two-job split** that separates untrusted repo code execution from the
OIDC publish token. This is the security-critical design: only the job that never runs repo
scripts holds `id-token: write`.

### Job 1: `verify` (unprivileged)

**Permissions:** `contents: read` only — no OIDC token.

Runs all repo code, gates, and packing. Steps in order:

| Step | What it does |
|---|---|
| Checkout exact commit | Exact-SHA checkout (`ref: ${{ github.sha }}`), `persist-credentials: false` |
| Setup Node | Node 24.18.0, npm pointed at registry.npmjs.org |
| Setup Bun | Bun 1.3.14 |
| Install dependencies | `bun install --frozen-lockfile` |
| Run gates | `bun run ci`, `bun run typecheck`, `bun test` — all must pass |
| Clean release workspace | `git status --porcelain=v1 --untracked-files=all` (line 51) — fails if any file was mutated during gates |
| Read package metadata | Reads `name` and `version` from `package.json` via Node inline script |
| Derive release version | `bun scripts/release-version.ts` → version string + dist-tag |
| Pack release tarball | Mutates `package.json` version in-memory, stamps `build-info.json --dirty false` (line 99), runs `npm pack --ignore-scripts`, verifies tarball via `scripts/verify-release-tarball.ts` |
| Upload immutable release tarball | `actions/upload-artifact` — uploads the single `.tgz`; `overwrite: false` prevents replacement |
| Cleanup verify workspace | Removes `build-info.json` and temp files; always runs |

The clean-check (line 51) runs **after** the gates and **before** packing. It guards against
files mutated or generated during the gates themselves (e.g., a script that writes a generated
file as a side effect). Local uncommitted files never reach the runner — GitHub-hosted runners
always start from a clean checkout of the pushed commit.

`build-info.json` is stamped with `--dirty false` explicitly (line 99) after the clean-check
passes. A `dirty: true` value in a published tarball means the stamping step was bypassed or
the workflow was modified.

### Job 2: `publish` (OIDC-privileged, depends on `verify`)

**Permissions:** `contents: read` + `id-token: write`.
**No checkout. No Bun. No dependency install. No repo scripts.** The only runtime setup is a
pinned Node 24.18.0 action, which provides npm >=11.5.1 for Trusted Publishing and configures the
public npm registry without enabling a package-manager cache.

Downloads the artifact uploaded by `verify` and independently validates it before publishing.
Steps in order:

| Step | What it does |
|---|---|
| Download exact release artifact | `actions/download-artifact` — fetches the single `.tgz` from `verify` |
| Setup Node | Pinned `actions/setup-node` configures Node 24.18.0, registry.npmjs.org, and no package-manager cache; it does not install dependencies |
| Validate release artifact | Pure Node inline script: extracts `package/package.json` and `package/build-info.json` from the tarball; asserts package name, public access, canonical registry, exact branch-specific version shape, `build-info.version == manifest.version`, `build-info.commit == GITHUB_SHA`, and `build-info.dirty == false`; derives dist-tag from branch |
| Registry preflight | Queries registry for candidate version and current tag; decides skip/publish/fail (same monotonicity logic as before) |
| Publish release tarball | `npm publish <tgz> --ignore-scripts --access public --provenance --tag <dev\|latest> --registry https://registry.npmjs.org/` |
| Cleanup publish artifacts | Removes downloaded artifact and temp files; always runs |

The `id-token: write` permission is confined to this job. It is never present in `verify`,
which is the job that runs repo code and installs dependencies. This ensures that even if a
supply-chain compromise in a dependency or a gate script attempted to exfiltrate an OIDC
token, none would be available.

---

## Idempotent rerun behavior

GitHub reruns keep the **same `GITHUB_RUN_ID`**. That means a staging rerun produces the
**same** version string (`0.8.0-dev.<run-id>.g<sha>`) as the original attempt — not a new one.

The workflow's preflight check handles this:

- If the expected version **already exists in the registry** and the target dist-tag (`dev` or
  `latest`) **already points to it** → the publish step is skipped and the run exits green.
  This is the safe idempotent path.
- If the expected version already exists but the dist-tag points **elsewhere** (e.g., a later
  build has since advanced the tag) → the run **fails**. This is intentional: silently
  re-tagging over a newer build would be a regression.
- If the expected version does not exist → publish proceeds normally.

For main, the version comes from `package.json`. If the version was never published, a rerun
publishes it. If it was already published and `latest` already points to it, the rerun is a
no-op (green). A manual out-of-band publish of the same version (bypassing the workflow) may
leave the registry in a state where the version exists but `latest` does not point to it,
causing the rerun to fail with a tag-mismatch error rather than an E403.

To trigger a rerun of a failed workflow:

```bash
gh run rerun <run-id> --repo Apegurus/solidity-argus
```

---

## Main stable promotion

When staging has been validated and you're ready to cut a stable release:

1. Bump `version` in `package.json` on the staging branch (e.g., `0.8.0`).
2. Open a PR from `staging` into `main`.
3. CI must pass. Merge.
4. The publish workflow runs on the main push and publishes `0.8.0` tagged `latest`.

Verify:

```bash
npm view solidity-argus dist-tags
# { latest: '0.8.0', dev: '0.8.0-dev.<last-staging-run>.g<sha>' }

npm view solidity-argus@latest version
# 0.8.0
```

The `dev` tag stays pointing at the last staging build. It doesn't move on a main publish.

---

## Failure diagnosis

### OIDC 403 from npm

**Symptom:** The publish step exits with `403 Forbidden` and a message like `This package requires a Trusted Publisher`.

**Cause:** The Trusted Publisher entry is missing, the workflow filename doesn't match, or the owner/repo values are wrong.

**Fix:**
1. Go to npmjs.com > solidity-argus > Settings > Publishing > Trusted Publishers.
2. Confirm the entry shows `Apegurus / solidity-argus / publish.yml`.
3. If absent, add it. If present but wrong filename, delete and recreate.
4. Rerun the workflow.

Do not add an `NPM_TOKEN` secret as a workaround. The workflow is designed for OIDC only; a token would be a regression.

### Conflicting version on main

**Symptom:** `npm ERR! 403 You cannot publish over the previously published versions of solidity-argus`.

**Cause:** `package.json` version was not bumped before merging to main, or someone published manually with the same version.

**Fix:** Bump the version in `package.json`, open a new PR to main, and merge. Do not attempt to unpublish the existing version.

### Registry outage

**Symptom:** The publish step times out or returns a 5xx from registry.npmjs.org.

**Cause:** npm registry is having an incident.

**Fix:** Check https://status.npmjs.org. Wait for the incident to resolve, then rerun the workflow.
Rerunning the **same** workflow run reuses the same `GITHUB_RUN_ID` and therefore the same
version string. The preflight check handles this correctly: if the version was never received
by the registry it publishes; if it was already received it skips (idempotent). Either way the
run exits green once the registry is healthy. Only a **new push** (or a new manually triggered
run with a new run ID) produces a new unique dev version.

### Test or pack failure before publish

**Symptom:** The workflow fails before reaching the publish step.

**Cause:** `bun test` failed, `bun run typecheck` failed, or `npm pack` produced an unexpected tarball.

**Fix:** Fix the failing tests or type errors on the branch, push again. The publish step never ran, so there's nothing to clean up in the registry.

### Misleading green CI on a direct push

**Symptom:** CI shows green but the published package is from a dirty or untested state.

**Cause:** Branch protection was not configured. A direct push bypassed the PR requirement, so CI ran on the pushed commit but no review or required-check gate was enforced.

**Fix:** Configure branch protection (see Prerequisites). Audit the published version:

```bash
npm view solidity-argus@dev --json | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('gitHead:', d.get('gitHead'))
print('version:', d.get('version'))
"
```

Compare `gitHead` against the expected commit. If it's wrong, move the `dev` tag to a known-good version (see Rollback below).

### Stale rerun / tag-mismatch failure

**Symptom:** A rerun of a previously completed workflow fails with a message like
`version X.Y.Z-dev.<run-id>.g<sha> already exists but dev tag points to a newer version` or
`candidate version is older than current dev`.

**Cause:** The workflow's preflight enforces a monotonicity rule: a candidate version that is
older than the version the dist-tag currently points to is **rejected**, even if the candidate
itself was published successfully in a prior run. This prevents a stale rerun from silently
rolling back the tag to an older build.

Two sub-cases:
- **Candidate older than current tag** → the tag has advanced since this run first executed
  (another push landed in between). The rerun is rejected. This is correct behavior — do not
  force-rerun; the newer build is already live.
- **Candidate equals current tag** → the rerun is a no-op and exits green (idempotent path).

**Fix:** If the tag has advanced past this run's version, no action is needed — the newer
build is already published. If you need to republish this specific version, move the dist-tag
manually (see Rollback) and then rerun. Only do this if you have a specific reason to revert
to the older build.

### Stale registry values after a successful publish

**Symptom:** `npm view solidity-argus dist-tags` still shows the old version minutes after the workflow completed.

**Cause:** npm's CDN has a propagation delay, typically under 60 seconds but occasionally longer.

**Fix:** Wait 2 minutes and retry. If still stale after 5 minutes, check the workflow log to confirm the publish step actually succeeded. A green workflow with a failed publish step is possible if the step's exit code was swallowed.

---

## Rollback by moving dist-tags

Never unpublish a version. npm's unpublish policy blocks removal of versions published more than 72 hours ago, and removing a recent version breaks anyone who pinned it. Instead, move the dist-tag to a known-good version.

### Roll back `dev` to a previous staging build

```bash
# List recent dev versions
npm view solidity-argus versions --json | python3 -c "
import sys, json
vs = json.load(sys.stdin)
devs = [v for v in vs if 'dev' in v]
print('\n'.join(devs[-10:]))
"

# Move the tag
npm dist-tag add solidity-argus@0.8.0-dev.<good-run-id>.g<good-sha> dev
```

Verify:

```bash
npm view solidity-argus dist-tags
```

### Roll back `latest` to a previous stable

```bash
npm dist-tag add solidity-argus@0.7.0 latest
```

Verify:

```bash
npm view solidity-argus@latest version
# 0.7.0
```

The bad version (`0.8.0` in this example) remains in the registry and is still installable by exact version. It just won't be what `npm install solidity-argus` resolves to.

---

## Old dev-version retention

Dev versions are never deleted. Every `0.8.0-dev.<run-id>.g<sha>` published to staging stays in the registry permanently. This is intentional:

- Debugging a production issue requires being able to install the exact build that was deployed.
- npm's immutability guarantee means the tarball content never changes under a given version string.
- The `dev` dist-tag is a moving pointer; old dev versions are just no longer the default `@dev` install.

If the volume of dev versions becomes a concern, the solution is to reduce push frequency on staging (e.g., require manual workflow dispatch), not to unpublish old versions.

---

## Current registry state (as of this writing)

```
npm latest: 0.7.0
package.json version (staging branch): 0.8.0
dev dist-tag: not yet published
```

The first staging publish after merging this feature will create `0.8.0-dev.<run-id>.g<sha>` and set the `dev` tag. The first main publish (after bumping to `0.8.0` and merging) will set `latest` to `0.8.0`.
