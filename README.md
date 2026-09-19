# Probe

**Your first team of users. Before your real users.**

## Local diagnostics & repair dashboard

Open **[http://127.0.0.1:4310/#dashboard](http://127.0.0.1:4310/#dashboard)** after the launch steps below. Probe stays **local-only**: the API, dashboard, and demo bind to loopback.

- **Scan a local page:** collect runtime/server errors, form-label and control-name issues, image text, layout overflow, and contextual security-header suggestions. Each finding includes the exact observation, route/selector, expected behavior, evidence, and a suggested correction.
- **Pinpoint and investigate:** click the captured page (or use the keyboard), describe a suspected missed issue, and ask the TrueForge agent to inspect fresh evidence for that element. Matching objective observations can be independently confirmed; model inferences stay Suspected.
- **Propose → Build fix:** connect your app's clean local Git repository with `PROBE_SOURCE_ROOT`. The agent prepares a reviewable source diff. **Build fix** checks the patch in a disposable Git worktree, runs the project's build and tests, and applies passing changes to your original working tree without committing. Dirty/stale source, failed checks, invalid patches, and cancellation prevent application. Rescan after reloading your app to check the live result.
- **Personal feedback:** explain why a finding is a false positive or a real issue. Scoped lessons persist in local SQLite and inform future investigations/proposals. Original evidence remains visible; lessons can be forgotten. This is agent memory, not model-weight training.
- **Stress testing:** bounded GET load with request/concurrency/rate controls, p50/p95/max latency, throughput, status counts, failures, and HTTP 429 reporting. Stops at rate-limit/error boundaries and supports cancellation.
- **Control-plane protection:** per-client API/MCP limits, stricter write/job limits, bounded SSE connections, cross-origin/rebinding protection, and security response headers.

Scans and stress tests do not require a model. Deeper investigations and source proposals require TrueForge with a working configured model. The dashboard's configurable local targets are separate from the existing full-audit profile, which retains its fixed target and account workflow.

See **[dashboard setup and repair workflow](docs/workbench.md)** for configuration, exact limits, supported repairs, and verification commands.

Probe runs a bounded team of **30 GPT-5.6 Sol specialists** against the authorized product at `http://localhost:3000/signup`. Agents create real accounts with synthetic identities, explore assigned workflows in separate browsers, and record functional, accessibility, usability and restricted security evidence. Their observations are not human sentiment or a guarantee of 100% coverage.

## Historical full-audit release status

- **Release checks:** 32 tests passed, zero failed; production build passed, recorded in `.data/acceptance/full-audit-launch.json`.
- **Full audit: terminal INCONCLUSIVE.** [Recorded 30-specialist run](http://127.0.0.1:4310/#run/49131e1e-2c31-479d-be5d-33d760536377) ran **19 September 2026, 21:45:54–21:49:11 UTC**. The live API checked at 21:50:27 UTC reports **six verified accounts; three assignments completed, three failed, 24 blocked**. Reported usage: **990,722 input / 12,867 output tokens**. The earlier launch snapshot correctly recorded a running audit; it is superseded by this terminal result.
- **Confirmed functional defect:** `/essays` fails with missing **`@visx/responsive`**, independently reproduced in a fresh browser/TrueForge session. Four other findings remain three **Suspected** and one **Inconclusive**. A real target signup **HTTP 500** stopped further registrations. Three agents hit the provider's **32-iteration limit**, a harness failure being addressed separately. This run establishes neither comprehensive coverage nor an all-passed product, and no target code was changed.
- **Real-signup pilot:** `d3ffda43-52dc-444e-9c3c-7343392aa2a4` verified a real account and actual Sol/browser execution, including nine completed browser actions, then was explicitly cancelled by the operator. It did not finish an audit. Gmail connectivity and multiple generated plus-alias authentications have been verified.
- **Historical demo:** [Fieldnotes agent run](http://127.0.0.1:4310/#run/25d6a8d8-aad1-4ae3-8a22-675e62943dc9) completed four real model turns, independent clean reproduction, and an unchanged regression that failed before the prepared fix and passed afterward. This evidence applies to the original demo.

See [verification](docs/verification.md), [full-audit operation](docs/full-audit.md), [architecture](docs/architecture.md), and [Probe identity](docs/brand.md).

## Launch

Requires Node **22.14+**, npm, and the target application running separately on port **3000** with its real authentication/backend configuration.

```bash
npm ci
npx playwright install chromium
cp .env.example .env
npm run build
npm start
```

Probe: **http://127.0.0.1:4310**. Fieldnotes demo: **http://127.0.0.1:4311**. For development, use `npm run dev` and **http://127.0.0.1:5173**; Vite proxies backend requests. Stop an existing Probe server before starting another.

Run `npm run trueforge` in a second terminal. Open **http://127.0.0.1:8790 → Settings → Models** and configure **`openai/gpt-5-6-sol`**. Full audits use this fixed model. Provider credentials belong in TrueForge Settings, never frontend variables or agent prompts. Model listing alone does not prove successful execution.

### Start a full-product audit

Open **http://127.0.0.1:4310/#new/audit**, review the specialist catalog, goal and ceilings, then start. Inspect the returned run URL for signup proofs, queue state, actual steps, findings and coverage.

Defaults: **30 specialists, four concurrent, 60 steps per agent, 60 minutes, 3,000,000 reported tokens**. These are ceilings, not promised duration or coverage. Duration comes from actual timestamps; no artificial delays fill the time limit. Target-AI requests are limited to **six per agent**. Token accounting depends on provider metrics and checks between work units, so it is not a precise prepaid spending cap.

In TrueForge, ask the saved **`probe`** agent to run the full 30-agent audit with real signup. Its **`start_full_audit`** tool returns the live run URL immediately. `get_probe_run` / `wait_for_probe_run` report actual progress; launching is not completion. If launcher registration is missing, restart Probe after TrueForge becomes available or use `POST /api/probe/connect`.

API entrypoints: **`GET /api/audits/catalog`** and **`POST /api/audits`**. The target is fixed; arbitrary URLs are unsupported.

### Real accounts

The backend generates unique Gmail plus aliases from the user-configured test mailbox. Account passwords and the Gmail app password stay in the encrypted local backend vault; the app password is never given to an agent. See [mailbox setup](docs/full-audit.md#mailbox-and-authentication).

Signup submits the real UI form and requires server authentication evidence from **`/api/profile`**. A local-only fallback or navigation alone does not count. Backend IMAP reads recent confirmation messages addressed to the exact generated alias and accepts only an approved authentication verification link. Accounts and test-owned content write to the target's **real configured remote backend** and may persist after a run.

## Results and limits

### Chat → dashboard behavior

Send **“Go and test this app: http://localhost:3000/signup with Probe”** to the saved `probe` agent or the repaired earlier owner/editor chat. The default is a **30-agent full-product audit**, not a signup form check. TrueForge starts background workers, returns **“Running in Probe dashboard”** with the actual saved run URL, and ends the chat turn while testing continues.

The dashboard shows all 30 assignments, with four executing concurrently. Each specialist first creates a separate real account, then completes prerequisites and investigates its assigned product workflows. Agent panels show **work phase** and **product interactions after signup**. Signup/onboarding alone cannot count as a completed product-testing assignment.

The ordinary New Run page now defaults to the full audit. The demo remains at `/#new/demo`; `/#new/signup` is explicitly a **Quick form check**. The reusable TrueForge agent only uses that smaller mode when the user explicitly asks for a quick read-only form check.

- Specialists have separate TrueForge sessions, browser contexts, cookie jars and scoped MCP capabilities. Dynamic subagents and arbitrary code/network tools are disabled.
- Findings start **Suspected**. Confirmation requires matching original objective evidence and independent reproduction in a fresh browser/reasoning session. At most **six objective findings** are reviewed. Subjective UX stays **Suspected**; insufficient replay evidence is **Inconclusive**.
- Security checks cover approved anonymous reads, own-account/session behavior and benign input handling. This is not penetration testing or security/accessibility certification. OAuth, payments, invitations, public posting, account deletion and administrative actions are excluded.
- Completion and page visits do not mean every feature passed. Harness blocks, prerequisites, signup failures and exhausted budgets are explicit coverage limits.
- One run is active at a time, with a bounded specialist queue. Cancellation closes browsers and cancels sessions but cannot undo committed writes. Restarted/interrupted runs become **Inconclusive**, retaining evidence without resuming browsers.
- **Full-audit regression generation is not implemented.** Compare preserved before/after runs manually. Generated regressions and prepared-fix verification belong to the original Fieldnotes demo only.
- The control server remains loopback-bound. This is a local operator tool, not an internet-ready multi-tenant service. Screenshots are action snapshots, not video. Cost is unavailable; no pricing is inferred.

## Persistence

| Location | Contents |
| --- | --- |
| `.data/customer-zero.sqlite` | Runs, separately indexed events, agent states, findings and evidence references |
| `.data/artifacts/<run-id>/` | Screenshots, network/DOM/authentication assertions, sanitized traces and coverage report |
| `.data/audit-vault/` | Private encrypted account/mailbox records and local encryption key |
| `.data/acceptance/full-audit-launch.json` | Release launch/check/pilot snapshot, not a completion certificate |
| `.data/demo.sqlite` | Original demo's isolated fixtures and sessions |
| `regressions/<run-id>/` and `.data/verification/` | Original-demo tests and before/after reports |

Revisit `/#run/<run-id>` for saved results. The UI exports the record and links evidence. Large snapshots can contain a recent-event window; the database retains separate event history.

## Original demo and read-only signup check

**Load demo workspace** and **Deterministic browser proof** run Fieldnotes without model calls. `npm run verify:demo` exercises clean reproduction and the same regression against broken/corrected fixtures; `npm run verify:agent` runs the original TrueForge investigation. See [the demo script](docs/demo-script.md).

`/#new/signup` and TrueForge's `test_signup_page` retain the explicit quick, read-only signup smoke check. The MCP tool requires `quickReadOnlyOnly: true`. It does not create accounts or verify backend authentication; ordinary “test this app” requests use the full audit.

```bash
npm test
npm run typecheck
npm run build
npm run verify:demo  # requires the application server; original demo only
```

Historical research and official TrueForge references: [docs/research.md](docs/research.md).
