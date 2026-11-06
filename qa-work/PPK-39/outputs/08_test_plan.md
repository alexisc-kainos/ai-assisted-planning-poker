---
work-id: "PPK-39"
skill: "qa-test-plan (framework applied manually; specialized agent/tool unavailable)"
framework-version: "unknown"
created: "2026-11-06T08:48:11Z"
inputs:
  - source: ".backlog/local/story-local-keep-the-app-awake-while-a-facilitators-session-is-open-for-up-to-90-minutes.ticket"
    revision: "Local ticket retrieved 2026-11-05; source is untracked"
  - source: "backend/src/server.ts, backend/src/config.ts, backend/test/server.test.ts, backend/package.json, docs/api-contract.md, README.md, render.yaml"
    revision: "feature/ppk-39-keep-awake at d89206f0ae04b6b826c429342e8bdee2675d94e6"
  - source: ".github/ai-qa/framework/method/safety.md, readiness.md, traceability.md, scenario-format.md, regression-areas.md and templates/test-plan.md"
    revision: "Observed 2026-11-06"
  - source: "User decisions in chat"
    revision: "Confirmed 2026-11-06: self-ping; log and retry failures; fixed 10-minute interval"
---

# Test Plan — PPK-39

## TL;DR

- **Verdict:** Go with conditions — implementation and automated verification are ready to proceed; deployed Render behavior still requires environment validation.
- **Top risks:** 1. **HIGH:** a missed/expired keep-awake request can let Render sleep and destroy in-memory room state. 2. **MEDIUM:** the behavior depends on Render's public URL and idle policy. 3. **MEDIUM:** network failures must remain visible and be retried without extending the room deadline.
- **Next action:** Implement room expiry tracking and the conditional self-pinger, then add fake-time tests.

## Next Steps

| # | Action | Owner | Evidence (FR/NFR/scenario ID) | Blocker | Source |
|---|---|---|---|---|---|
| 1 | Arrange deployment/access and verify the Render idle lifecycle | Developer/user | FR1, FR3–FR5, TS-08 | Yes | Ticket testing notes |
| 2 | Review the final diff and request separate L2 approval before any commit | Developer/user | FR1–FR7 | Yes | `method/safety.md` |

**Author:** User / implementation agent
**Date:** 2026-11-06
**Project:** AI-assisted Planning Poker
**Scope:** PPK-39
**Status:** Implementation complete; local QA passed; Render validation pending

## Summary

Implement a backend-only keep-awake mechanism for active rooms. Store a deadline for each newly created room, fixed at 90 minutes from creation by default. While at least one deadline is active and `RENDER_EXTERNAL_URL` is configured, request the service's `/health` endpoint every 10 minutes. Remove the deadline when its room closes; do not extend it for joins, departures, or host changes. Expire it even if the room remains open. Log failed requests and retry on the next scheduled tick without changing any deadline.

The room duration is configurable without a code change; the 10-minute cadence is fixed by user decision. No public URL means no self-ping, preserving local/test behavior. No public API or WebSocket protocol change is planned. The user approved this scope and test plan; that approval does not authorize gated test execution, publication, push, or PR actions.

The repository's QA project context describes a Playwright skeleton, whereas this repository is a Node/TypeScript application with backend Vitest tests. Commands and test levels below are based on the actual repository manifests; the conflicting QA project context is not silently repaired.

## QA Summary

| Ticket | Readiness | Max risk | Coverage verdict | Scenarios written/not written | Automated/manual/not needed | Run result | Published |
|---|---|---|---|---|---|---|---|
| PPK-39 | Amber | HIGH | Needs Improvement — Render validation pending | 8 written / 0 omitted | Automated TS-01–TS-07; manual TS-08 | PASS 188 backend tests/typecheck/build; TS-08 BLOCKED | Not published |

### Readiness assessment

| Dimension | Score | Evidence |
|---|---:|---|
| Requirements clarity | 4/5 | AC01–AC07 are explicit; self-ping, failure behavior and cadence were confirmed in chat. |
| Acceptance criteria quality | 5/5 | Duration, per-room boundaries, overlap and stop conditions are measurable. |
| Testability | 4/5 | Timer behavior can be tested with fake time; the actual Render idle transition needs deployment validation. |
| Automation readiness | 5/5 | Existing backend Vitest suite and configuration support focused automated coverage. |
| Observability | 3/5 | User approved logging failed health requests; success metrics/audit events are not specified and will not be invented. |
| QA confidence | 4/5 | Local timer behavior is testable; external Render access and the exact idle observation remain unverified. |

**Readiness:** Amber.
**QA ownership:** Integration Coverage Required.
**Recommendation:** ✅ Integration Test Required.

## Risk Assessment

The highest supported risk is **HIGH**: the feature protects an active workshop from Render idling, while the room's state is process-local and lost if the service restarts. A missed ping could therefore interrupt sessions and discard in-memory state. The most important mitigation is deterministic automated coverage of expiry boundaries and overlapping rooms, followed by deployed Render validation. This change does not add persistence or change the accepted post-window behavior.

## Requirements Breakdown

Source: local PPK-39 ticket, original acceptance criteria AC01–AC07. IDs remain stable through implementation and execution. **No NFRs are specified in the ticket.**

| ID | Requirement / measurable outcome | Source | Ambiguity |
|---|---|---|---|
| FR1 | A newly created room keeps the app active for 90 minutes from its creation time by default. | AC01 | Render's actual idle policy must be checked in the deployed service. |
| FR2 | A room's deadline is independent of joins, leaves, and facilitator/host changes. | AC02 | None after user confirmation. |
| FR3 | Keep-awake stops at the room's 90-minute deadline even if it remains open, or earlier when it closes. | AC03 | Room itself remains open past its keep-awake deadline if members remain. |
| FR4 | With multiple rooms, keep-awake continues while any room deadline remains active and stops when the last expires or all rooms close. | AC04 | None. |
| FR5 | Once no deadline remains, the app may idle normally in the absence of other traffic. | AC05 | Actual provider idle observation requires Render access. |
| FR6 | With no open rooms, no keep-awake request is made. | AC06 | None. |
| FR7 | The room duration can be changed through `ROOM_KEEP_AWAKE_DURATION_MS` without a code change. | AC07 | Positive integer milliseconds; default is 5,400,000 (90 minutes). |

### Confirmed design decisions

- Use the backend self-ping approach against its public `/health` route.
- Use Render's supplied `RENDER_EXTERNAL_URL` when present; with no public URL, do not ping.
- The ping interval is fixed at 10 minutes; only the 90-minute duration is configurable.
- On ping failure, log the failure and retry on the next tick. A failure neither extends a deadline nor stops tracking other rooms.

## Traceability Matrix

| FR/NFR | Existing evidence (test/assertion or gap) | Scenarios | Automation decision (assessed / automated / deliberately not automated, with reason) | Test files | Last result (run / environment / time) |
|---|---|---|---|---|---|
| FR1 | `/health` and per-room expiry implemented | TS-01, TS-07 | Assessed; automated | `backend/test/keepAwake.test.ts`, `backend/test/config.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| FR2 | Server calls tracker only on room creation and final close | TS-02 | Assessed; automated | `backend/test/server.test.ts`, `backend/test/keepAwake.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| FR3 | Deadline expiration and early close handling implemented | TS-03, TS-04 | Assessed; automated | `backend/test/keepAwake.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| FR4 | Multiple room expiries tracked independently | TS-04 | Assessed; automated | `backend/test/keepAwake.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| FR5 | Render sleep behavior remains environment-dependent | TS-04, TS-08 | Assessed; automated timer assertion and manual validation | `backend/test/keepAwake.test.ts`; Render evidence pending | Automated PASS; TS-08 BLOCKED |
| FR6 | No URL disables requests; no active room stops the timer | TS-03, TS-05 | Assessed; automated | `backend/test/keepAwake.test.ts`, `backend/test/server.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| FR7 | Positive duration is loaded from `ROOM_KEEP_AWAKE_DURATION_MS` | TS-07 | Assessed; automated | `backend/test/config.test.ts` | PASS — full backend suite; Node v22.22.1; 2026-11-06 |
| NFR | None specified | — | Deliberately not added; no source requirement | — | Not applicable |

## Test Scenarios

Scenario format: BDD, consistent with the available QA convention. Automated coverage uses only local resources: fake time and stubbed requests for keep-awake timing, plus loopback WebSocket coverage for server lifecycle wiring. Tests must not contact Render. Assertions verify request timing/counts, expiry independence, and no requests after the final deadline.

### TS-01 — Start a room's keep-awake window

**Category:** Backend logic, timer boundary
**Covers:** FR1
**Environment/data:** Local backend; configured public URL; fake time; default duration.
**Evidence:** Request spy and recorded clock/timing assertions.

GIVEN no room exists and the backend is configured with a public health URL
WHEN the first user creates a room
THEN that room receives a deadline 90 minutes after creation
AND the backend requests `/health` on the fixed 10-minute cadence while the deadline is active
AND it makes no request when no active deadline remains.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** See execution evidence below.

### TS-02 — Keep the deadline independent of membership and host

**Category:** Backend logic, lifecycle regression
**Covers:** FR2
**Environment/data:** Local backend; one room with multiple simulated connections; fake time.
**Evidence:** Room deadline and request schedule before/after membership changes.

GIVEN a room has an active keep-awake deadline
WHEN users join, leave, or the host changes
THEN the deadline remains anchored to the room's original creation time
AND those membership changes do not extend or shorten its keep-awake window.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** Server lifecycle wiring and manager timing were both exercised.

### TS-03 — Stop keep-awake when a room closes early

**Category:** Backend logic, cleanup
**Covers:** FR3, FR6
**Environment/data:** Local backend; one room; fake time; configured public URL.
**Evidence:** Request spy after the final member disconnects.

GIVEN a room's 90-minute deadline has not elapsed
WHEN its final member disconnects and the room closes
THEN the room's deadline is removed
AND no further keep-awake request is made if no other room is active.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** —

### TS-04 — Continue for overlapping rooms until the last deadline

**Category:** Backend logic, asynchronous boundaries
**Covers:** FR3, FR4, FR5
**Environment/data:** Local backend; two rooms created at different fake times; configured public URL.
**Evidence:** Request counts across each deadline and after the final deadline.

GIVEN two rooms have active deadlines and the second room was created later
WHEN the first room's deadline expires
THEN keep-awake requests continue for the second room
WHEN the second room's deadline expires
THEN no further keep-awake request is made even if either room remains open
AND the app is no longer actively kept awake by this feature.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** —

### TS-05 — Do not ping without a configured public URL

**Category:** Environment configuration, local/test behavior
**Covers:** FR6
**Environment/data:** Local backend with `RENDER_EXTERNAL_URL` absent; fake time.
**Evidence:** Request spy and confirmation room creation/joining still works.

GIVEN the backend has no configured public service URL
WHEN a room is created and fake time advances through the keep-awake window
THEN the backend makes no outbound keep-awake request
AND ordinary room creation and joining behavior remains available.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** —

### TS-06 — Log and retry after a failed health request

**Category:** Integration failure, logging
**Covers:** FR1, FR4
**Environment/data:** Local backend; fake time; request stub fails once then succeeds; log spy.
**Evidence:** Logged failure, request attempts, unchanged room deadlines.

GIVEN at least one room has an active deadline
WHEN a scheduled health request fails
THEN the failure is logged and the room deadline is unchanged
AND the next scheduled tick retries the health request
AND the failure does not stop keep-awake for another active room.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** Failure logging and scheduled retry assertions passed.

### TS-07 — Configure the room duration

**Category:** Configuration boundary
**Covers:** FR1, FR7
**Environment/data:** Local config loader; unset, valid and invalid duration values.
**Evidence:** Parsed config values and invalid-value error assertions.

GIVEN `ROOM_KEEP_AWAKE_DURATION_MS` is absent
WHEN backend configuration is loaded
THEN the room duration defaults to 90 minutes (`5400000` milliseconds)
WHEN a valid alternate duration is configured through `ROOM_KEEP_AWAKE_DURATION_MS`
THEN the room deadline uses that duration without a code change
AND invalid duration input is rejected with a clear configuration error.

**Result:** PASS — included in the focused backend suite.
**Status:** PASS
**Notes:** Default, override and invalid values were covered.

### TS-08 — Verify the deployed Render lifecycle

**Category:** Deployment integration, manual
**Covers:** FR1, FR3, FR4, FR5
**Environment/data:** Deployed Render service; test room(s); Render dashboard/access; no unrelated inbound traffic during observation. Render documents a 15-minute free-service idle threshold: [free web services](https://render.com/docs/free).
**Evidence:** Record observed service availability during the active window and the service's idle transition after all deadlines and the provider's normal idle grace period; do not use repeated external health probes that would mask idling.

GIVEN a room is open on the deployed service
WHEN the room's keep-awake window is active with no other inbound traffic
THEN the deployed service remains available for the active window
WHEN all room windows expire or rooms close
AND no other traffic arrives
THEN the service is allowed to idle under Render's normal policy.

**Result:** Not run
**Status:** BLOCKED until deployment and Render access are available
**Notes:** The observation can take at least the 90-minute configured window plus the provider's 15-minute idle threshold.

### Scenarios Not Written

| Requirement ID / category | Why omitted | Existing passing evidence |
|---|---|---|
| None | All ticket acceptance criteria map to TS-01–TS-08; no additional NFR was specified. | TS-01–TS-07 pass locally; TS-08 is written but blocked pending Render access. |

## Automation Recommendation

| Scenario | Decision | Level/location | Rationale | Impact |
|---|---|---|---|---|
| TS-01–TS-07 | Automated | Backend Vitest; local timer/request fakes | Deterministic, repeatable, quick, isolated from production, and directly asserts deadlines, multiple rooms, config and failure behavior. | Low |
| TS-08 | Manual | Render deployment/dashboard | Provider sleep/availability is environment-dependent and cannot be established by local fake-time tests. Must not use external polling that prevents idling. | High |

Automation factors considered: repeatability, speed, stability, test data, environment availability, external dependencies, maintenance, value of the assertion, and observability. Fake time/request handling is preferred for interval boundary coverage; actual Render behavior remains manual.

## Execution Evidence

Focused local validation was executed on macOS with Node v22.22.1 at 2026-11-06T08:57Z:

| Command | Result |
|---|---|
| `npm test -w backend -- test/keepAwake.test.ts test/config.test.ts test/server.test.ts` | PASS — 3 test files, 100 tests |
| `npm run typecheck -w backend` | PASS |
| `npm run build -w backend` | PASS |

The user separately approved the full backend suite on local macOS / Node v22.22.1. At 2026-11-06T08:59Z:

| Command | Result |
|---|---|
| `npm test -w backend` | PASS — 4 test files, 188 tests |

No Render deployment test was performed. TS-08 remains blocked until deployment and Render access are available.

## Regression Impact

- Room creation, last-member close handling and host/member transitions in `backend/src/server.ts`.
- Runtime configuration in `backend/src/config.ts`.
- `/health` behavior remains `200 ok`; the new internal request must not alter response or CORS behavior.
- No frontend, WebSocket message, room state persistence, database, authentication, or ticket protocol changes.
- On server shutdown, all keep-awake timers must be cleared; outstanding work must not hold the process open.

## Environment Impact

- `RENDER_EXTERNAL_URL`: Render-provided public URL; absent in local/test contexts, where outbound keep-awake calls must be disabled.
- `ROOM_KEEP_AWAKE_DURATION_MS`: positive integer in milliseconds; defaults to `5400000`.
- Ping cadence: fixed at 10 minutes by user decision; not configurable.
- Test dependencies: local Node 22 workspace dependencies already present; do not install packages.
- No credentials, real user data, or production test data required.
- TS-08 requires an available Render deployment and observation access; no deployment or external change is authorized by this plan.

## Open Questions

- Requirements/design: None after user decisions.
- Execution prerequisite: Render deployment/access for TS-08 is Unknown; record BLOCKED until confirmed.
- Observability: failure logging is in scope by user decision; success metrics/audit events are not specified and are not added by assumption.

## Regression Risk Matrix

| Area | Risk Level | Why? / evidence | Regression Needed? | Automation Update Needed? |
|---|---|---|---|---|
| API Behaviour | LOW | No API contract or health response change; `/health` remains `200 ok`. | Yes — health response regression | Yes — existing health assertion remains |
| Existing Endpoints | MEDIUM | The existing health route becomes an internal keep-warm target; route behavior must remain stable. | Yes | Yes |
| Feature Flags | LOW | No feature flag is introduced. | No | No |
| Caching | LOW | No cache exists or changes. | No | No |
| Authentication / Authorisation | LOW | No auth path is involved. | No | No |
| API Gateway | MEDIUM | Self-pings traverse the configured public service URL and depend on deployed routing. | Yes — TS-08 | Manual deployment check |
| Backend Logic | HIGH | New asynchronous per-room deadlines affect whether active sessions can be lost to idle shutdown. | Yes — TS-01–TS-04 | Yes — fake-time tests |
| Database Layer | LOW | No database; room state remains in-memory. | No | No |
| Data Integrity | MEDIUM | Deadlines must not drift on membership/host changes; room state remains ephemeral after process restart. | Yes — TS-02–TS-04 | Yes |
| Logging / Monitoring | MEDIUM | Failed requests must be visible and retried; success telemetry is not specified. | Yes — TS-06 | Yes — log assertion |
| Environment Configuration | HIGH | Behavior depends on URL presence and configurable duration/default. | Yes — TS-05, TS-07, TS-08 | Yes |
| CI/CD Pipeline | LOW | No workflow or deploy pipeline change planned. | No | No |
| Backward Compatibility | LOW | No client or wire-protocol behavior changes. | Yes — existing backend tests | Yes — backend regression suite |

## Drift

The configured QA project context identifies a different Playwright skeleton, while the checked-out project uses Node 22, backend TypeScript and Vitest. This plan uses the actual repository's manifests and source. No project configuration was edited. Specialized QA agents/tools were unavailable; framework methods were applied directly and that limitation is recorded in the index.
