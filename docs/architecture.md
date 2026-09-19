# Probe architecture

## Local diagnostic and repair workspace

`src/client/Workbench.tsx` is the default dashboard (`/#dashboard`). The existing audit and demo screens remain available. `src/server/workbench/` adds its own SQLite job/memory store, bounded read-only Chromium diagnostics, screenshot-to-DOM pinpoint mapping, evidence-informed TrueForge analysis, scoped feedback, and paced local stress testing. REST polling retains progress over navigation/reload. Operation locks also guard legacy coordinator entrypoints, including MCP-launched runs.

Repair proposals use selected tracked files from `PROBE_SOURCE_ROOT`. Exact-span edits become a reviewable diff. Build verification runs in a detached Git worktree, then source hashes/commit/cleanliness are checked again before atomic application to the connected repository. Model-supplied commands and arbitrary paths are not accepted. Build success and subsequent live-page verification are distinct results.

`src/server/security.ts` centralizes loopback/origin protection, security headers, rate buckets and SSE capacity. The server still binds only to loopback. See [workbench operation](workbench.md) for limits, configuration and verification semantics.

## Current full-product audit

`src/server/audit/` implements the bounded real-account audit. The original Fieldnotes architecture below remains specific to that historical demo; its two-role fixture and regression constraints do not describe the new profile.

```text
AuditSetup / AuditRun → REST + SSE → audit coordinator → SQLite/events/artifacts
                                      │
                       30 specialists queued; 4 concurrent by default
                                      │
                       distinct TrueForge role sessions
                                      │ scoped MCP capabilities
                       separate Playwright browser contexts
                                      │ approved UI/API requests
                       localhost:3000 → configured remote backend
                                      ↑
                       encrypted identity vault + backend Gmail IMAP
```

- **`catalog.ts` / `policy.ts`** define 30 specialist assignments, fixed target and `openai/gpt-5-6-sol`, approved routes/methods and auth-origin restrictions.
- **`coordinator.ts`** queues specialists, serializes registrations and streams real turns. Defaults: 30 agents, four concurrent, 60 steps each, 60 minutes, 6,000,000 reported tokens. Token checks depend on returned metrics and do not form an exact billing cap. Real timestamps determine duration without artificial time-filling delays. Provider429 errors use cancellable shared backoff and same-session continuation; successful browser writes are not automatically repeated.
- **`browser.ts`** binds a capability to one browser/account, exposes ephemeral control references, captures evidence, and requires server `/api/profile` authentication after real UI signup. Target-AI calls are limited to six per agent. Arbitrary JavaScript, HTTP, cookies and filesystem access are not agent tools.
- **`identity.ts` / `mailbox.ts`** encrypt synthetic passwords and the user-configured Gmail app password in the local backend vault. Unique plus aliases receive confirmation messages; backend IMAP checks recent exact recipients and approved verification links. The app password is never given to agents. Approved actions write to the target's real configured remote backend.
- **`mcp.ts`** exposes `browser_action`, `report_finding` and `finish_assignment` for the capability-bound specialist. Separate TrueForge sessions supply separate reasoning contexts; Probe enforces browser isolation. Dynamic subagents, sandbox and web search are disabled.

Findings begin **Suspected**. Original evidence must match a supported objective assertion before review. At most six objective candidates receive a new reviewer browser and TrueForge session using the same synthetic account. Matching independent evidence is required for confirmation. Subjective UX stays Suspected; insufficient replay is Inconclusive. This is restricted security observation, not penetration testing or certification.

`src/shared/types.ts` adds `AuditInput`, `AuditAssignment`, `AuditAgent`, `AuditState`, `AuditAssertion` and `AuditReproduction` to persistent runs. `src/client/AuditSetup.tsx` reads `GET /api/audits/catalog` and starts via `POST /api/audits`. `src/client/AuditRun.tsx` renders states, queue, actual duration, evidence and coverage. UI entry: `/#new/audit`. TrueForge's saved `probe` agent invokes `start_full_audit` and returns the live URL immediately.

One run is active at a time. Cancellation closes browsers and cancels sessions but cannot undo committed writes. Restart recovery marks interrupted audits Inconclusive with retained evidence and no browser restoration. Full-audit regression generation is not implemented; before/after comparison is manual between preserved historical runs. Automated regression sections below apply only to Fieldnotes.

See [full-audit operation](full-audit.md) and [verification](verification.md). The current 30-agent run ended Inconclusive with six verified accounts and one independently confirmed functional defect; three assignments completed, three failed and 24 were blocked. Historical demo proof does not establish comprehensive audit coverage.

## Original Fieldnotes demo architecture

```text
React dashboard (4310, or Vite 5173)
       │ REST + application SSE, persisted snapshots
       ▼
Probe coordinator ────────────────── SQLite + artifact files
       │
       ├── private fixture functions ─── Fieldnotes server (4311)
       │
       ├── official TrueForge SDK ───── TrueForge (8790)
       │                                  │
       │                         persistent owner/editor sessions
       │                                  │ real model/tool loop
       └── actor-scoped MCP ◀──────────────┘
                  │ backend capability binding + phase gates
                  ├── owner BrowserContext + owner cookie
                  └── editor BrowserContext + editor cookie
                                 │ allowlisted browser requests
                                 ▼
                           Fieldnotes server
```

## Ownership of behavior

| TrueForge provides | Probe implements |
| --- | --- |
| Real model execution loop and tool routing | Scenario phases, deterministic barriers, deadlines |
| Persistent sessions and turns | Actor-to-session mapping, browser lifecycle and authentication |
| MCP connector execution | Typed MCP server, unguessable actor capability, environment route allowlist |
| Turn streaming and stored execution history | Application SSE, SQLite run history, artifact collection, UI |
| `sessions.cancel()` | Capability revocation, browser closure, stopping regression subprocesses |
| Optional approvals, sandbox, skills and dynamic subagents | No external writes exposed; independent clean reproduction and local regression runner |

The role sessions use **inline agent specs** with exactly one named MCP connector each. Connector credentials are configured through `settings.mcpServers.create`, not injected into prompts. Sessions are created with `sessions.create`, turns with `sessions.createTurnStream`, events consumed with `.withMetadata()`, and cancellations with `sessions.cancel`. The code uses installed SDK **0.2.0** camelCase fields (`mcpServers`, `requireApprovalForTools`, `dynamicSubAgents`). Some conceptual docs show wire-format snake_case; the installed generated types are authoritative for TypeScript.

## The actual agent loop

For an agent-mode run, the coordinator creates two TrueForge sessions. For each phase it gives the relevant actor an objective and the intended product rules. **The model chooses the tools and browser actions** from page inspection. The coordinator never calls the scripted click list for those investigation phases.

1. **Preconditions:** fresh workspace; distinct browser/server sessions; editor has no grant.
2. **Share:** owner agent inspects the document and sharing dialog, then grants access. The coordinator requires a real successful network response and committed grant.
3. **Open:** editor agent establishes authorized document access. The coordinator requires the private fixture in a real editor read response.
4. **Revoke:** owner agent removes access. The coordinator requires HTTP 200, absent grant in response, absent grant in database, and committed activity.
5. **Check:** editor agent investigates a fresh export. The coordinator requires response evidence from a request issued after revocation.
6. **Assess:** deterministic checks decide whether the observed result violates the rule. An agent observation never sets Confirmed.
7. **Reproduce:** an independent deterministic driver uses a different seed, browser contexts and account sessions. It repeats the real browser procedure and objective assertions. UI events label this driver explicitly.
8. **Regression:** generate an executable Playwright test and capture an actual before result. Operator selects the prepared corrected variant to capture an after result.

The deterministic mode calls the same scoped browser layer with explicit scripted actions in place of model turns. It does not synthesize model output, token usage, or TrueForge events.

## Tools and isolation

`inspect_page`, `navigate`, `click`, `capture_screenshot`, `get_evidence`, `report_observation`.

- A backend-generated bearer capability resolves to `{fleet, role}`. Tools accept **no actor/context/session selector**.
- Each browser context gets a distinct HttpOnly synthetic server session. Session tokens are hashed in the demo database.
- Browser routing rejects account-switching/login, fixture controls, source files, other workspace paths, other ports, public origins, internal-network URLs, downloads and popups. Navigation accepts two enumerated document paths.
- No evaluate/script execution, arbitrary HTTP request, cookie inspection or filesystem tool is exposed.
- Only the active role may navigate/click; allowed writes also depend on the current phase. Per-actor in-flight locks serialize actions.
- Reports/evidence reads are actor-scoped. A role cannot read the other role's evidence through its tools.
- Coordinator fixture functions and deterministic internal-state checks are not MCP tools and are not disclosed to the investigating sessions.
- Dynamic subagents are disabled: separate reasoning contexts would still share tools and sandbox. Browser security boundaries are custom backend enforcement, not a claimed TrueForge feature.

## Verification semantics

A result is only unauthorized access if:

- revocation response is successful and contains no editor grant;
- the coordinator separately confirms committed ACL removal;
- export has a later request sequence and request timestamp;
- the server supplies a new, distinct request ID and the post-revocation document revision;
- it is not a service-worker response and has `Cache-Control: no-store`;
- a new HTTP 200 export body contains the protected random fixture marker.

HTTP 403 without the marker is a healthy result. Missing response evidence, unexpected status/body, failed browser actions, a broken model call, or an incomplete stream yields an honest Inconclusive result. Screenshots support these assertions; they do not replace network/state proof.

Finding transitions: **Suspected → Reproducing → Confirmed / Not reproduced / Inconclusive**. Historical confirmed findings remain historical observations after prepared-fix verification.

## Persistence and lifecycle

`src/shared/types.ts` defines Run, Actor, scenario slug, Phase, ActionEvent, EvidenceArtifact, Finding and VerificationRun. SQLite stores each run's typed aggregate and a separately indexed event log. Artifacts are immutable UUID-addressed files. Each event has timestamp/run attribution, optional actor/session attribution and artifact references. Snapshots and terminal results survive UI refresh.

The application SSE sends current run snapshots, allowing the UI to reconnect without claiming provider stream-resume semantics. Full sanitized provider events are also kept in NDJSON trace artifacts. Stream sequence numbers are preserved. Automatic TrueForge turn resubscription and browser restoration after process death are intentionally not implemented; recovery explicitly marks active runs Inconclusive and attempts to cancel their saved provider sessions.

Cancellation aborts pending SDK operations, calls the documented TrueForge cancellation API, revokes capabilities, closes browser processes, prevents further browser actions and terminates a running regression process group. In-flight writes may already have completed; they are never blindly retried. Ordinary timeouts trigger page inspection before any model-directed retry.

### Closed connectors and the reusable chat agent

The persistent TrueForge transcript outlives its run-scoped browser. Previously, resuming a completed actor chat failed MCP initialization with a 401 because its in-memory browser capability was gone. Probe now persists only the capability hash plus role/run attribution. Once the browser closes (or is lost on restart), a known credential exposes `probe_session_status` and `start_fresh_signup_check`. The original account browser cannot be resumed, switched, navigated or written to. The fresh-check tool uses only the separately authorized exact signup target, starts a clean unauthenticated context and returns a different run ID. Unknown credentials still receive HTTP 401.

For older completed connectors, startup matches exact locally recorded run IDs, role events and the expected local connector URL, rotates them to the restricted handoff credential and records the repair. It also updates the known terminal inline TrueForge session using the supported `sessions.update` API, so the previous editor-role prompt no longer refuses a newly requested signup check. Running turns and unrelated sessions are not changed. New investigative sessions receive the same handoff spec after cleanup. No historic messages or artifacts are rewritten, and the original actor's browser authority is not restored.

`src/server/launcher.ts` registers a separate persistent `probe-launcher` MCP connector and a saved TrueForge agent named **`probe`**. Its credential is stored with mode 0600 in `.data/probe-launcher.key`, never in the frontend. It has explicit tools to start a new demo investigation, wait for observable run updates and read the local result. It never accepts an actor browser selector. The coordinator continues enforcing role boundaries in the actual investigative sessions.

### Authorized signup surface profile

The user explicitly authorized `http://localhost:3000/signup`. A separate `test_signup_page` tool runs a deterministic, bounded procedure against only that exact target, using a fresh unauthenticated context. Only GET/HEAD for `/signup`, `/_next/static/` and favicon assets are allowed. Network writes, other pages and APIs, cross-origin requests, WebSockets, downloads and popups are blocked. The procedure checks native form constraints without submitting a form, toggles visibility with a synthetic test value, clears it before screenshots, and captures desktop/mobile views.

This result is persisted as `scenario: signup-surface`, `mode: deterministic`, one visitor actor, explicit objective checks and limitations. The TrueForge agent chooses to invoke the procedure and summarizes observed results. This is not represented as independent model-selected browser exploration or a multi-account test. No account creation, OAuth or backend authentication is verified.

The same bounded procedure is available in Probe at `/#new/signup` through `POST /api/signup/run`, with the existing loopback, origin and strict input validation. The UI can launch it without TrueForge. The generic New Run page exposes a target-profile selector rather than suggesting arbitrary URLs can be entered into the Fieldnotes demo form.

## Test generation and the prepared correction

The deterministic generator compiles the verified access contract into a stable Playwright test. It uses `data-testid` locators and response assertions, not screenshots as backend proof. The same file path and SHA-256 hash are recorded for before and after runs. Test runner crashes/timeouts are distinguished from expected assertion failures.

The broken implementation's export path permits the editor role without checking its current ACL. The corrected implementation checks the current grant. Both are real server branches in `src/demo/store.ts`; the UI cannot change a response by relabeling it. A fresh isolated fixture is used for every verification. There is no public reset or fault-selection endpoint on Fieldnotes.

No TrueForge sandbox is attached to testing agents because that would enlarge their tool surface without helping the browser scenario. Local test execution is explicitly our implementation. `docs/procedures/revocation.md` is a reusable application testing procedure; it is not advertised as a registered TrueForge sandbox skill.
