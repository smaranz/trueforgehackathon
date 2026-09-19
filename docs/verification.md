# Verification record

## Full-product chat default verified

- Current unit/boundary checks: **35 tests passed**, including signup-only completion prevention and cancellable provider-rate-limit backoff. Production build passed.
- Exact request sent in the previously problematic TrueForge session `01m2xmm5nh9t6kd51nkggmtqws`: **“Go and test this app: http://localhost:3000/signup with Probe.”**
- The chat invoked the full audit and replied **“Running in Probe dashboard”** with the actual run URL, then completed while the audit continued in background.
- Latest new run: `99ee31c0-a906-4338-8238-91980afa369e`, **30 assignments**, four concurrent workers, six-million-token ceiling. No signup-surface run was created by that prompt. The chat returned while the run was actually running.
- Prior routing-verification run `2c4369a7-8110-4f13-b183-943d720e0258` created seven accounts and recorded16 actual product interactions across dashboard, settings and applications before a model-provider429 stopped it. This exposed the need for error-driven backoff; the latest run uses the corrected recovery behavior. Prior run evidence remains unchanged.
- Dashboard verified against actual APIs at1440×1000 and390×844:30 agent cards, zero page overflow, zero console errors.
- Routing proof: `.data/acceptance/full-audit-routing.json`. The live run supplies ongoing account/coverage/results; full completion is not claimed at launch.

Records from this machine, 19 September 2026. Historical proofs and current-release progress have distinct scopes.

## Current full-audit release — terminal INCONCLUSIVE

Final state checked through **`GET /api/runs/49131e1e-2c31-479d-be5d-33d760536377`** at **21:50:27.687 UTC**, projecting status/counts/evidence without account credentials. Run ended **21:49:11.604 UTC** with **Inconclusive**. `.data/acceptance/full-audit-launch.json`, observed **21:46:11.877 UTC**, remains the historical launch/execution snapshot; its running state is not the final result.

- Release tests: **32 passed, zero failed**. Production build: **passed**, as recorded by the release verifier. These checks were not rerun during the documentation update.
- Full run: **`49131e1e-2c31-479d-be5d-33d760536377`**, started **21:45:54.750 UTC**. [Recorded report](http://127.0.0.1:4310/#run/49131e1e-2c31-479d-be5d-33d760536377). Actual elapsed duration: approximately **3 minutes 17 seconds**, not the 60-minute ceiling.
- Configuration: **30 agents, four concurrent, 60 steps each, 60 minutes, 3,000,000 reported tokens**, fixed **`openai/gpt-5-6-sol`**.
- **Terminal counts:** six verified accounts; **three completed, three failed, 24 blocked** assignments. Reported TrueForge usage: **990,722 input tokens / 12,867 output tokens**; no cost inferred.
- **Historical launch snapshot:** three verified accounts, two completed Sol turns, six completed browser actions and 22 artifacts; two agents exploring, two signing up, 26 queued. Zero findings at that early snapshot was not a passing verdict.
- Gmail connectivity and multiple generated plus-alias authentications are verified. No mailbox address, app password, account password or token is included here.
- Pilot: **`d3ffda43-52dc-444e-9c3c-7343392aa2a4`**, one verified real account and actual Sol execution, **nine completed browser actions** (13 recorded steps). Explicitly **cancelled by the operator** after sufficient launch evidence; full onboarding/investigation completion was not claimed.
- Pilot route blocks for `/api/counselor/activity` and `/_next/image` were harness limits, not asserted product defects.

### Terminal findings and blockers

- **Confirmed functional defect:** finding `3427b431-dbfb-4c08-8a34-70372f8a7fc6`, “Essays route fails to load because a required chart module is missing.” `/essays` displayed the development error interface with **`Module not found: Can't resolve '@visx/responsive'`**. A fresh browser and independent TrueForge session **`01m2xt8sgcxz9kp8ht8h84jxcy`** reproduced the same objective uncaught-exception predicate. Three evidence references are attached to the finding.
- **Inconclusive:** essay prompt/inspiration error-overlay finding; independent replay lacked sufficient matching objective evidence. This is not proof of a fix.
- **Suspected:** blank onboarding page, finishing-onboarding HTTP 500/dashboard error, and anonymous essay-documents HTTP 500. These were not promoted to confirmed defects.
- **Registration blocker:** `audit-07` received real signup **HTTP 500**, with a non-JSON authentication response; no authenticated session was established and further registrations stopped. The remaining 24 assignments were blocked, not passed.
- **Harness failures:** `audit-01`, `audit-02` and `audit-04` reached the provider's **iteration limit of 32**. These are execution-limit failures, not target defects. A separate harness correction is in progress; no corrected rerun is claimed here.

The audit is terminal, not still running. Six accounts and one independently confirmed defect demonstrate real execution; they do not establish comprehensive 30-assignment coverage or a product-wide pass. No target code was changed. No 100% coverage or security certification is claimed. Full-audit regression generation is not implemented; manual comparisons preserve separate before/after run histories.

## Historical original-demo verification

## Commands

- Earlier `npm test`: **16 passed** at that historical checkpoint (browser/MCP boundaries, retired actors, restricted handoff, signup scope and demo authorization/session tests). This is not the current-release test count.
- `npm run build`: TypeScript check and production Vite build **passed**.
- `npm run verify:demo`: complete deterministic end-to-end acceptance **passed**.

## Captured runs

Latest deterministic proof:

- Broken run: `73408b9f-513b-40c4-99b1-36065874d5f5`
- Corrected healthy run: `afd30103-e8ac-409f-8193-9ab83fa52da6`
- Finding reproduced in a distinct clean environment and **Confirmed**.
- Regression result against broken variant: **failed**, exit 1.
- Same regression against corrected variant: **passed**, exit 0.
- Same SHA-256 for both: `4e923c3781fef6ab72dad9725343be92e2271538f605f2b83c8b7ae6390e06f5`.
- Healthy run: **zero findings**.

Source: `.data/acceptance/demo-verification.json`. Artifact locations are referenced by the persisted runs. Running the script again creates new run IDs and refreshes that manifest.

## UI inspection

Used the actual backend and saved artifacts, not API fixtures:

- Desktop: **1440×1000**.
- Mobile: **390×844**.
- Both real actor screenshots loaded.
- Run, finding, and before/after views rendered correctly.
- Refresh retained finding and verification results.
- No horizontal page overflow and no browser console errors.
- One expected SSE request abort was observed when navigating/reloading; the stream reconnected to persisted state.

Screenshots:

- `.data/acceptance/ui-new-run.png`
- `.data/acceptance/ui-run.png`
- `.data/acceptance/ui-finding.png`
- `.data/acceptance/ui-verification.png`
- `.data/acceptance/ui-mobile.png`

## Successful TrueForge investigation

Run: `25d6a8d8-aad1-4ae3-8a22-675e62943dc9`.

- Model: **`openai/gpt-5-6-sol`**.
- Four completed real model turns with scoped MCP browser execution.
- Owner session: `01m2xmm5nd9khv5tnabg7v4nft`.
- Editor session: `01m2xmm5nh9t6kd51nkggmtqws`.
- Agents chose the investigative browser actions and reported network-backed observations.
- Fresh unauthorized export observed after acknowledged revocation.
- Independent clean deterministic reproduction: **Confirmed**.
- Unchanged regression: broken **failed**, corrected **passed**, identical SHA-256 `4e923c3781fef6ab72dad9725343be92e2271538f605f2b83c8b7ae6390e06f5`.
- Actual usage reported by TrueForge: **150,622 input tokens / 2,095 output tokens**. No model cost was inferred.

Open `http://127.0.0.1:4310/#run/25d6a8d8-aad1-4ae3-8a22-675e62943dc9`. Full sanitized execution traces and the before/after artifacts are attached to the persisted run. Summary: `.data/acceptance/agent-verification.json`.

## Earlier blocked TrueForge attempt

Run: `e6315bec-a028-44a2-b168-e0884e2e77f9`.

The official SDK created separate persistent owner and editor sessions and received real `turn.created`, `mcp.initialize`, `model.message` and terminal `turn.done` events. The model provider rejected its configured credential with **HTTP 401**. The run correctly ended **Inconclusive**, with **no finding**.

That earlier attempt used `openai/gpt-5-4-mini`. It remains in history as an honest failed attempt. After the user updated the model configuration and selected Sol, the successful run above verified actual agent reasoning and tool execution.

## Original-demo remaining scope

- The corrected healthy variant has a verified deterministic investigation; a separate healthy TrueForge investigation has not been run.
- Third-role investigations and the other two scenarios are not implemented.
- The original demo does not use sandbox execution, registered TrueForge skills, dynamic reviewer subagents or external-write approvals. Its browser scope is local synthetic fixtures. The full audit separately permits bounded real signup and test-owned writes to the configured backend, with independent reviewer sessions.
- Browser restoration after backend restart is unsupported; interrupted runs become Inconclusive with retained evidence.

## TrueForge chat / expired connector repair

- The exact failing connector `cz-25d6a8d8-f86dffb9-editor` was repaired and successfully initialized through the official TrueForge `mcpServers.listTools` API. Its original browser stays retired; it exposes status plus a fresh, unauthenticated, signup-only task handoff.
- A saved agent **`probe`** was registered with a dedicated stable launcher connector.
- Real TrueForge chat session `01m2xq2y5ed9r0a4eyyy4bjtss` invoked `test_signup_page` for the authorized Publick target.
- Persisted report: `9127b126-bc5d-4ec9-a097-e62ebb0767af`.
- **10/10 deterministic signup surface checks passed** with real browser evidence and desktop/mobile screenshots.
- No registration submission, account creation, Google OAuth, email verification or backend authentication was performed.
- Execution record: `.data/acceptance/probe-launcher-stream.ndjson` and `.data/acceptance/probe-launcher-verification.json`.

### Same archived chat handoff verified

The exact archived editor session **`01m2xmm5nh9t6kd51nkggmtqws`** was updated with the supported inline session-spec API. Sending the signup test request again caused a real model tool call that started a **new browser**, completed **10/10 surface checks**, and returned the actual report instead of refusing or suggesting the wrong form.

- New report from the archived chat: `a8a79571-bba1-480e-921b-b2fa5f1f6046`.
- Trace and summary: `.data/acceptance/probe-archive-handoff-stream.ndjson` and `.data/acceptance/probe-archive-handoff-verification.json`.
- Direct UI route `/#new/signup`, profile switching, refresh, desktop and mobile layout were verified through actual browser interaction.
- Clicking **Start signup check** in the UI completed a second independent report: `6d03743c-84f7-4d1a-b539-7e37263a27e0`, **10/10 checks passed**.
- UI screenshots: `.data/acceptance/probe-signup-start.png` and `.data/acceptance/probe-signup-start-mobile.png`.
