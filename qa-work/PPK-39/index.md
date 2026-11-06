---
work-id: "PPK-39"
skill: "qa-workflow"
framework-version: "unknown; QA analysis/test-plan agents unavailable, framework methods applied manually"
created: "2026-11-06T08:48:11Z"
inputs:
  - source: ".backlog/local/story-local-keep-the-app-awake-while-a-facilitators-session-is-open-for-up-to-90-minutes.ticket"
    revision: "Local ticket retrieved 2026-11-05; source is untracked"
  - source: "Repository code and manifests"
    revision: "feature/ppk-39-keep-awake at d89206f0ae04b6b826c429342e8bdee2675d94e6, based on origin/main"
  - source: ".github/ai-qa/framework/method/safety.md, readiness.md, traceability.md, regression-areas.md, artefacts.md"
    revision: "Observed 2026-11-06"
  - source: ".github/ai-qa/project/project.md and conventions/*"
    revision: "Observed 2026-11-06; context conflicts with this repository"
---

# QA Work Index — PPK-39

## TL;DR

- **Verdict:** Go with conditions — the approved implementation is complete and local checks pass; deployed Render validation remains outstanding.
- **Top risks:** 1. **HIGH:** an expired or missed self-ping can allow Render to sleep and lose in-memory room state. 2. **MEDIUM:** runtime behavior depends on Render's public URL and idle policy. 3. **MEDIUM:** an unsuccessful health request needs clear logging and retry behavior.
- **Next action:** Complete Render lifecycle validation after the PR is merged and deployed; merge and deployment have not occurred.

## Next Steps

| # | Action | Owner | Evidence (FR/NFR/scenario ID) | Blocker | Source |
|---|---|---|---|---|---|
| 1 | Arrange deployment/access and verify the Render idle lifecycle | Developer/user | FR1, FR3–FR5, TS-08 | Yes | Ticket testing notes |
| 2 | Review final diff and request separate L2 approval before any commit | Developer/user | FR1–FR7 | Yes | Safety gate |

**Scope:** PPK-39 — keep the app awake for 90 minutes after a room is created.
**Branch / revision:** `feature/ppk-39-keep-awake` at `cd790d0894b03ee51977b6d653c91eb843bd05de`, based on `origin/main`.
**Workflow:** Implementation complete; local QA complete; Render validation blocked.
**Updated:** 2026-11-06

## Workflow step status and staleness

| Workflow | Step | Status | Artefact | Inputs checked / latest revision | Staleness / note |
|---|---|---|---|---|---|
| design | Analyse requirement | Complete | This index and `outputs/08_test_plan.md` | Local PPK-39 ticket; branch code at `d89206f` | Direct assessment against framework; `qa-analyse-requirement` agent/tool unavailable |
| design | Code context / branch verification | Complete | This index | `server.ts`, `rooms.ts`, `config.ts`, backend tests, manifests, contract, README | Current at branch base |
| design | Requirement coverage gaps | Complete | `outputs/08_test_plan.md` | Ticket AC01–AC07 and existing backend tests | No NFR specified; Render validation remains planned |
| design | Design manual scenarios | Complete | `outputs/08_test_plan.md` | Approved scenario plan | BDD format used; no execution evidence yet |
| design | Regression risk | Complete | `outputs/08_test_plan.md` | Backend lifecycle, runtime configuration, in-memory room state | Risk assessment is design-time |
| design | Automation plan | Complete | `outputs/08_test_plan.md` | Vitest backend suite | QA plan skill unavailable; framework method applied manually |
| design | Design review | Skipped | — | — | No separate design-review agent/tool available |
| design | Final test plan | Complete | `outputs/08_test_plan.md` | User approved scope and plan in chat | Approved for implementation; refreshed with executed evidence |
| automate | Generate tests | Complete | `backend/test/keepAwake.test.ts`, `backend/test/config.test.ts`, `backend/test/server.test.ts` | Branch code after implementation | Focused inventory implemented |
| automate | Run tests | Complete | `outputs/08_test_plan.md` | Node v22.22.1; macOS; 2026-11-06T08:59Z | Full backend tests, typecheck and build pass; Render scenario not run |

## Traceability matrix

| FR/NFR | Existing evidence (test/assertion or gap) | Scenarios | Automation decision (assessed / automated / deliberately not automated, with reason) | Test files | Last result (run / environment / time) |
|---|---|---|---|---|---|
| FR1 | `/health` and per-room expiry implemented | TS-01, TS-07 | Assessed; automated | `backend/test/keepAwake.test.ts`, `backend/test/config.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| FR2 | Server calls tracker only on room creation and final close | TS-02 | Assessed; automated | `backend/test/server.test.ts`, `backend/test/keepAwake.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| FR3 | Deadline expiration and early close handling implemented | TS-03, TS-04 | Assessed; automated | `backend/test/keepAwake.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| FR4 | Multiple room expiries tracked independently | TS-04 | Assessed; automated | `backend/test/keepAwake.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| FR5 | Render sleep behavior remains environment-dependent | TS-04, TS-08 | Assessed; automated timer assertion; manual validation required | `backend/test/keepAwake.test.ts`; Render evidence pending | Automated PASS; TS-08 BLOCKED |
| FR6 | No URL disables requests; no active room stops the timer | TS-03, TS-05 | Assessed; automated | `backend/test/keepAwake.test.ts`, `backend/test/server.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| FR7 | Positive duration is loaded from `ROOM_KEEP_AWAKE_DURATION_MS` | TS-07 | Assessed; automated | `backend/test/config.test.ts` | PASS — full backend suite, Node v22.22.1, 2026-11-06 |
| NFR | None specified in the ticket | — | Deliberately not added; no NFR source requirement | — | Not applicable |

## QA Summary

| Ticket | Readiness | Max risk | Coverage verdict | Scenarios written/not written | Automated/manual/not needed | Run result | Published |
|---|---|---|---|---|---|---|---|
| PPK-39 | Amber | HIGH | Needs Improvement — Render validation pending | 8 written / 0 omitted | Automated TS-01–TS-07; manual TS-08 | PASS 188 backend tests/typecheck/build; TS-08 BLOCKED | Not published |

## Open questions

- No requirement or design questions remain after the user confirmed self-pinging, retry-on-failure, and a fixed 10-minute ping interval.
- Render access and deployment availability for TS-08 are Unknown; manual validation remains blocked until available.
- The repository QA project context describes a different Playwright skeleton. It was not used for implementation or command selection and will not be modified here.
- The specialized `qa-analyse-requirement` and `qa-test-plan` agents/tools were unavailable; the analysis and plan were prepared directly from the repository QA framework methods/templates.

## Gate log

| Gate | Action / target | Exact payload or command / side effects | Approver and time | Outcome / ID or URL |
|---|---|---|---|---|
| Workflow plan | Implement PPK-39 with the scoped behavior and test plan | Self-ping using `RENDER_EXTERNAL_URL`; default 90-minute room expiry; fixed 10-minute interval; log and retry failures; tests TS-01–TS-08 | User, 2026-11-06 | Approved in chat |
| L2 | Create and switch to ticket branch | `git switch -c feature/ppk-39-keep-awake origin/main`; excludes unrelated `b60ab11` generated-artwork commit; untracked paths preserved | User, 2026-11-06 | Created; HEAD `d89206f0ae04b6b826c429342e8bdee2675d94e6` |
| Focused local checks | Run focused tests, typecheck and build | `npm test -w backend -- test/keepAwake.test.ts test/config.test.ts test/server.test.ts` (100 passed); `npm run typecheck -w backend`; `npm run build -w backend` | User approved test plan, 2026-11-06 | PASS on Node v22.22.1 / macOS; 2026-11-06T08:57Z |
| L3 | Full backend test suite | `npm test -w backend` on local macOS / Node v22.22.1; loopback test servers only; no external service or persistent data | User, 2026-11-06 | Approved and PASS; 4 files / 188 tests at 2026-11-06T08:59Z |
| L3 | Render lifecycle validation | Deployed service, room window and Render dashboard/access; allow at least 90 minutes plus idle threshold | Pending access and exact environment approval | BLOCKED; not run |
| L4 | Push branch | Push `feature/ppk-39-keep-awake` / `cd790d0894b03ee51977b6d653c91eb843bd05de` to `origin` | User approved exact branch and commit, 2026-11-06 | PASS; remote ref verified with `git ls-remote` |
| L4 | Create pull request | Create PR in `alexisc-kainos/ai-assisted-planning-poker`, base `main`, head `feature/ppk-39-keep-awake`, title `feat(backend): keep Render awake during active rooms (PPK-39)`, approved description, no owner reviewers | User, 2026-11-06 | PASS; [PR #12](https://github.com/alexisc-kainos/ai-assisted-planning-poker/pull/12), verified open with expected base/head/title/body |
| L4 | Request Copilot review | Request `Copilot` on PR #12 using `gh pr edit --add-reviewer Copilot`; REST fallback attempted with same PR/reviewer | User, 2026-11-06 | FAILED; CLI returned GitHub Projects classic deprecation GraphQL error; REST API and PR view show no requested reviewers |
| L4 | Merge / deployment | No merge or deployment performed; user stated merge will deploy it | Not requested | Not performed |
