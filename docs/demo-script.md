# 90-second demonstration

## Before going on stage

- Start `npm start` and `npm run trueforge` in separate terminals.
- Fix the provider credential in TrueForge Settings and complete a real `npm run verify:agent` before presenting agent execution as working.
- Run `npm run verify:demo` to confirm the mechanism and prepare a disclosed recorded fallback.
- Use 1440×1000 or a similar desktop viewport. Open Probe and Fieldnotes side by side. For a current run, use its target URL plus `/login` in the human demo window. Human sessions are separate from actor contexts.
- Keep the real evidence open from `.data/acceptance/demo-verification.json`; select its `brokenRunId` in the sidebar. Refresh retains it.

## Timeline

**0–12 seconds — problem**

“Your owner test passes. Your editor test passes. But does the handoff between them pass? Probe is your first team of users, before your real users.”

Point to the owner and editor accounts. “They have distinct authenticated browser contexts.”

**12–30 seconds — coordinated actions**

Start the revoked-access scenario. Show owner sharing, editor reading, owner revoking. These are real browser screenshots refreshed after actions, not video.

If the agent run exceeds the slot, say: **“This is a recorded agent run; the timestamps and complete tool trace are preserved. I’ll do the short verification live.”** Use that wording only for a successfully completed real agent run.

If the credential remains unavailable, say: **“The harness integration reaches TrueForge, but the model provider rejects its key. This portion is our explicitly labeled deterministic browser proof.”** Do not call it agent reasoning.

**30–50 seconds — proof**

Open the finding. Show:

1. Owner revocation: HTTP 200, editor grant absent.
2. A later, distinct editor export request: HTTP 200 and the private fixture marker.
3. Independent reproduction: new seed and fresh sessions.

“The stale tab is the setup. The bug is the new server response after revocation.”

**50–65 seconds — executable regression**

Show the failing Playwright result and open the test artifact. Point to `expect(exported.status()).toBe(403)` and the assertion that the response must not contain protected content.

**65–83 seconds — prepared correction**

Click **Verify prepared fix**. Say: “This is an explicitly prepared server-side authorization correction, selected by the operator. The agent did not write it.”

Show corrected **passed**, broken **failed**, identical test hash. The assertion did not change.

**83–90 seconds — finish**

“One permission change, two perspectives, a reproducible failure, and a regression test we can keep.”

## Recorded fallback

Use an existing preserved run, labeled **Recorded run** by the application. A deterministic run is always labeled **Deterministic browser proof**. The live prepared-fix check is normally short; use actual captured duration, never promise a fixed latency.

## Scope disclosure

This MVP implements the owner/editor access-revocation scenario. Viewer and concurrent-edit investigations are planned. No sentiment or conversion claims; findings report observed product behavior.
