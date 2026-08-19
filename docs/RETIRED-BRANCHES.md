# Retired branches

Ten branches were deleted on 2026-08-18 after the merge catch-up. Each was
checked against main first; the evidence is below, per branch, so the decision
can be argued with rather than taken on trust.

**Nothing here is lost.** A deleted branch is a deleted *name* — the commits
survive as long as the objects do. To bring one back:

```bash
git fetch origin <sha>            # if it has already been pruned
git branch <name> <sha>
git push origin <name>
```

Six of the ten were already on main by another route or superseded by newer
code; deleting those removed a name, not work. Four (`tasks-extend-resolve…`,
`access-token`, and the two GCP branches) held real unmerged work that was
judged cheaper to rewrite than to reconcile. Those are the ones to look at
here first if someone asks where a feature went.

| branch | tip | ahead | last commit | verdict |
|---|---|---|---|---|
| `fix/analysis-cache-migration` | `e3991f1e47` | 1 | 2026-06-10 | Already on main by another route |
| `claude/email-processing-documentation-85ERA` | `79cedf2a11` | 4 | 2026-03-16 | Already on main, byte for byte |
| `claude/switch-to-amazon-ses-0sa3b` | `47d9c05c60` | 1 | 2026-03-07 | Done by another route (PR #62) |
| `spam` | `0bb0c897f9` | 1 | 2025-12-29 | Superseded |
| `feature/chrome-extension` | `c4e621f1a3` | 9 | 2026-06-13 | Superseded by the shipped extension |
| `chore/analysis-gemini-3-flash-preview` | `6a3baac166` | 1 | 2026-06-02 | Obsolete mechanism, live question |
| `infra/gcp-setup` | `38be5c6efb` | 8 | 2026-03-13 | Superseded by what is actually deployed |
| `claude/setup-gcp-vpc-infrastructure-oWnLH` | `23ae236ad2` | 5 | 2026-03-13 | Superseded (PR #63) |
| `tasks-extend-resolve-to-upsell-churn` | `d1573e9d63` | 3 | 2026-05-05 | Stale (PR #111) |
| `access-token` | `beef83ff56` | 1 | 2025-11-19 | Stale (PR #4) |

## `fix/analysis-cache-migration`

**Already on main by another route.** Tip `e3991f1e4714faa3739bb39ccd308a6ca8f0751e`, 1 commit ahead of main, last touched 2026-06-10 by Manish Balsara.

The branch adds `apps/api/sql/migrations/011_analysis_cache.sql`. Main already carries that exact migration, and `analysis_cache` is live in `apps/analysis/src/db/schema.ts`, `routes/analysis.ts` and `services/cache-service.ts`.

Commits:

- fix(analysis): add missing analysis_cache table migration

## `claude/email-processing-documentation-85ERA`

**Already on main, byte for byte.** Tip `79cedf2a11deab5db1ca2ba52d8b8c9e355a8e9f`, 4 commits ahead of main, last touched 2026-03-16 by Claude.

Both `EMAIL_PROCESSING_PIPELINE.md` and `EMAIL_PROCESSING_PIPELINE_CUSTOMER.md` hash identically to main's copies. This is why it merged with zero conflicts — there was nothing left to merge.

Commits:

- Add customer-facing email processing pipeline document
- Fix doc accuracy: remove keyword cache detail, expand batch/thread analysis
- Expand filtering documentation: blacklist, Gmail labels, body pattern matching
- Add email processing pipeline documentation for CEO walkthrough

## `claude/switch-to-amazon-ses-0sa3b`

**Done by another route (PR #62).** Tip `47d9c05c606af69d372cf4943602724021a78013`, 1 commit ahead of main, last touched 2026-03-07 by Claude.

The branch replaces Postmark with SES. Main's `apps/notifications/package.json` already depends on `@aws-sdk/client-ses`, and both `senders/email-sender.ts` and `channels/email/email-channel.ts` are on SES.

Commits:

- Switch email sending from Postmark to Amazon SES

## `spam`

**Superseded.** Tip `0bb0c897f9db283e7a4d88644cd82e7401590d29`, 1 commit ahead of main, last touched 2025-12-29 by Manish Balsara.

Main's `apps/analysis/src/services/email-filter.ts` is 771 lines against the branch's 628, and `classification-indicator.tsx` is identical. Merging would move the filter backwards.

Commits:

- Add missing email-filter and classification-indicator files

## `feature/chrome-extension`

**Superseded by the shipped extension.** Tip `c4e621f1a3916b46366db98fd454b8ce3c7f7c0b`, 9 commits ahead of main, last touched 2026-06-13 by Manish Balsara.

`apps/chrome-extension` exists on main and is the build documented in CLAUDE.md. The branch conflicts in 19 files against 43 changed — it predates the app it was proposing.

Commits:

- Address code-review findings (correctness + cleanup)
- Resolve thread customer from external sender, not recipients
- Merge remote-tracking branch 'origin/main' into feature/chrome-extension
- Build extension to output/ instead of .output/
- Harden /api/users/me: make tenantDomain enrichment best-effort
- Make customer-by-id stats enrichment opt-in (?stats=true)
- Scope customer-by-id enrichment to the read endpoint only
- Fix extension login, configurable URLs, and resolve customer by messageId
- Add Chrome extension with Gmail sidebar for customer context

## `chore/analysis-gemini-3-flash-preview`

**Obsolete mechanism, live question.** Tip `6a3baac166a67889c54127572de5aa37ebcc7ef1`, 1 commit ahead of main, last touched 2026-06-02 by Manish Balsara.

The branch hardcodes `primary: 'gemini-3-flash-preview'` per analysis type. Main since centralised on `DEFAULT_LLM_MODEL` in `packages/shared/src/constants/models.ts`, currently `gemini-2.5-flash`. Changing model is now a one-line constant edit; this branch's approach would reintroduce per-type hardcoding. **The product question — is gemini-3-flash-preview better here — is untouched by deleting this.**

Commits:

- chore(analysis): use gemini-3-flash-preview for LLM analysis

## `infra/gcp-setup`

**Superseded by what is actually deployed.** Tip `38be5c6efb4124e4e70c3688c704d38e111ab2c6`, 8 commits ahead of main, last touched 2026-03-13 by Manish Balsara.

Provisioning scripts from March 2026. Ten Cloud Run services now run in `project-y-email-sentiment`, provisioned by other means, and `.github/workflows/deploy.yml` is the live path.

Commits:

- Add mTLS client certificate auth for Cloud SQL
- Merge branch 'main' into infra/gcp-setup
- Update infra scripts for project-y-email-sentiment deployment
- Add verify.sh smoke-test script for each infrastructure step
- Remove database migration script (fresh deployment, no data to migrate)
- Remove unused GCP APIs from enable-apis script
- Add Langfuse and HuggingFace secrets for crm-analysis
- Add GCP VPC infrastructure scripts and harden CI/CD pipeline

## `claude/setup-gcp-vpc-infrastructure-oWnLH`

**Superseded (PR #63).** Tip `23ae236ad2302bc7061d0a19d513f1286ad14c54`, 5 commits ahead of main, last touched 2026-03-13 by Claude.

Same vintage and purpose as `infra/gcp-setup`; 10 conflicts against 15 changed files.

Commits:

- Add verify.sh smoke-test script for each infrastructure step
- Remove database migration script (fresh deployment, no data to migrate)
- Remove unused GCP APIs from enable-apis script
- Add Langfuse and HuggingFace secrets for crm-analysis
- Add GCP VPC infrastructure scripts and harden CI/CD pipeline

## `tasks-extend-resolve-to-upsell-churn`

**Stale (PR #111).** Tip `d1573e9d63d6d45be6daf6fdbe71194f032c5a9f`, 3 commits ahead of main, last touched 2026-05-05 by Manish Balsara.

May 2026. 8 conflicts across 14 files against a tasks module that has moved since. Not superseded by anything specific — genuinely abandoned rather than replaced, and cheaper to rewrite than to reconcile.

Commits:

- Rename /escalations route to /tasks; redirect legacy URLs
- Resolve dialog: prefer current signal filter; clean stale 'negative' strings
- Extend resolve/comment flow to upsell + churn tasks

## `access-token`

**Stale (PR #4).** Tip `beef83ff564e88482f008894ad090fb78e413294`, 1 commit ahead of main, last touched 2025-11-19 by Manish Balsara.

November 2025, before better-auth. Auth is now better-auth sessions over Postgres; see ADR-028.

Commits:

- access token
