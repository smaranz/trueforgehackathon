# Bounded full-product audit

Up to **30 specialists** investigate `http://localhost:3000/signup` using fixed **`openai/gpt-5-6-sol`** through TrueForge. Each receives a separate reasoning session and browser context. Models choose actions from observed controls; backend tools hold credentials and enforce scope.

**Latest launch: full audit running after chat-routing and provider-recovery fixes.** [Run 99ee31c0-a906-4338-8238-91980afa369e](http://127.0.0.1:4310/#run/99ee31c0-a906-4338-8238-91980afa369e) was started through the ordinary TrueForge request “Go and test this app: http://localhost:3000/signup with Probe.” The chat returned “Running in Probe dashboard” while30 assignments remained scheduled in background. Consult its live state for final results; completion is not claimed here.

**Earlier recorded result: terminal INCONCLUSIVE.** [Run 49131e1e-2c31-479d-be5d-33d760536377](http://127.0.0.1:4310/#run/49131e1e-2c31-479d-be5d-33d760536377) ran from **21:45:54 to 21:49:11 UTC on 19 September 2026**, with **six authenticated accounts; three completed, three failed and24 blocked assignments**, using **990,722 input /12,867 output tokens**.

The earlier missing **`@visx/responsive`** dependency on `/essays` was independently reproduced. The target's missing installed dependencies have since been restored, and signup/essays/dashboard now return200. The harness's premature32-iteration cutoff was also corrected. These repairs do not erase historical findings or establish a product-wide pass. See [verification](verification.md).

## Entry points and budgets

- UI: **`/#new/audit`**.
- **`GET /api/audits/catalog`**: assignments, model, fixed target and mailbox status.
- **`POST /api/audits`**: starts a saved run, returning HTTP 202.
- TrueForge saved **`probe`** agent: **`start_full_audit`** returns the live URL immediately; `get_probe_run` / `wait_for_probe_run` read progress.

Example request body:

```json
{
  "targetUrl": "http://localhost:3000/signup",
  "agentCount": 30,
  "concurrency": 4,
  "maxStepsPerAgent": 60,
  "deadlineMinutes": 60,
  "maxTotalTokens": 6000000,
  "goal": "Investigate assigned workflows with real synthetic accounts and report evidence, coverage and blockers."
}
```

| Budget | Default | Accepted range |
| --- | --- | --- |
| Specialists | 30 | 1–30; first N catalog assignments |
| Concurrency | 4 | 1–6, limited by agent count |
| Browser steps per specialist | 60 | 15–100 |
| Deadline | 60 minutes | 5–90 minutes |
| Reported total tokens | 6,000,000 | 100,000–6,000,000 |
| Target-AI endpoint requests | 6 per agent | Backend-enforced limit |

These are execution ceilings, not guaranteed duration, coverage or spend. Actual timestamps determine elapsed duration; there are no artificial time-filling delays. Rendering, network and confirmation polling take real time. Token metrics arrive after turns, so concurrent/in-flight work can exceed the nominal token budget before another check. Cost is unavailable.

One Probe run is active at once. Specialists enter a bounded queue; registrations are serialized so unverifiable signup stops further registrations promptly. Assignment completion is not a product-wide pass.

Ordinary testing prompts default to `start_full_audit`, including when the URL ends with `/signup`. The tool waits for actual preflight to start or fail, then returns a running/queued result and the dashboard URL; it does not wait for the audit to finish. Repeated launch requests reuse the existing active audit instead of starting duplicate account creation. The small signup form mode requires an explicit quick read-only request.

Registration is only phase1. Product testing and a recheck pass follow. Registration-only summaries are cleared before exploration. The backend records post-authentication interactions on approved product pages separately from signup, signin and onboarding, and it cannot mark an assignment completed without actual post-signup product interactions and a coverage report.

Model-provider429 responses produce an observable waiting event and shared exponential cooldown, honoring a reported retry interval with a bounded number of attempts. Recovery continues the same session and instructs the model to inspect state rather than repeat completed writes or signup. Cancellation interrupts the cooldown. The global audit deadline still applies; unresolved quotas remain an honest incomplete result.

## Mailbox and authentication

Configure the user-owned Gmail test mailbox through the existing backend script:

```bash
PROBE_MAILBOX_SECRET_FILE="/absolute/path/to/private-mailbox.json" npx tsx scripts/configure-audit-mailbox.ts
```

The private input has `email` and `appPassword` fields. Keep actual values out of documentation, prompts, source control and frontend configuration. The script encrypts the mailbox configuration in the backend vault and verifies Gmail IMAP connectivity. Synthetic identities use unique `+probe-` aliases. Account passwords are generated and held by the backend; the Gmail app password never enters agent context.

`.data/audit-vault/` uses AES-256-GCM, a local encryption key and restrictive file permissions. It is local backend storage, not an external secrets service. Optional **`AUDIT_AUTH_ORIGIN`** is the target project's exact public HTTPS authentication origin, not an API secret or model key.

Signup fills and submits the real UI, then checks server **`/api/profile`** authentication. A redirect, user identifier or local-only fallback alone is insufficient. Without a mailbox, fallback identities cannot receive confirmation mail and may block registration.

For confirmation, backend IMAP searches recent messages for the generated alias, validates exact recipient and timestamp, and accepts only the approved auth origin's `/auth/v1/verify` signup/email link with an approved local redirect. General mailbox access is not an agent tool. Credentials and verification tokens are not intended as report content.

Approved signup and content changes reach the target's **real configured remote backend**. Accounts and synthetic content may remain after a run; cancellation does not roll back committed writes.

## Coverage and findings

The catalog covers onboarding, projects, colleges, applications, essays, SAT, dashboard/roadmap/strategy, counselor workflows, profile/preferences, session boundaries, benign validation, keyboard/labels, mobile layouts, recovery and navigation. Assigned routes are intended scope, not proof of coverage. No arbitrary URLs, source-code, filesystem, unrestricted HTTP or JavaScript tools are available.

Security checks use own-account/session behavior, approved anonymous reads and benign input boundaries. This is not penetration testing, third-party account probing or security/accessibility certification. OAuth, payments, invitations, public posts, account deletion and administration are excluded. Harness blocks and budget exhaustion are limitations, not automatically target defects.

Findings cite the reporting agent's evidence and begin **Suspected**; screenshots alone are insufficient. Confirmation requires original evidence matching a supported objective predicate and independent reproduction in a fresh browser/TrueForge session, signing into the same synthetic account. At most **six objective findings** receive review. Supported predicates include captured server failures, layout overflow, uncaught exceptions and an anonymous response containing the agent's own synthetic marker. Subjective UX stays **Suspected** and represents observations, not human sentiment. Insufficient review evidence is **Inconclusive**, not proof of a fix.

## Persistence, cancellation and before/after

SQLite retains runs and separately indexed events. Artifacts retain screenshots, network/DOM/authentication assertions, sanitized traces and coverage/results reports. The UI exposes per-agent signup status, session IDs, actual steps/tokens, queue state, visited URLs, evidence and reproduction outcomes. Exported run snapshots may include only the recent-event window; the database retains the event log.

Cancel from the run page to stop queued/active work and close browsers. Restart recovery marks interrupted audits **Inconclusive**, preserving evidence without restoring browser state. Start a new run to investigate again.

**Full-audit regression generation is not implemented.** Preserve the original run ID/evidence, change the product, start a fresh audit, then manually compare equivalent objectives, conditions and objective evidence. Preserve both histories; an absent later finding does not establish a fix without matching coverage. Only the original Fieldnotes demo generates executable Playwright regressions and prepared-fix before/after results.
