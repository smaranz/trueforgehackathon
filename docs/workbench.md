# Local diagnostics, investigations, and repairs

## Run it

```sh
npm ci
npx playwright install chromium
cp .env.example .env
npm run build
npm start
```

Open `http://127.0.0.1:4310/#dashboard`. The original audit is under `/#new/audit`; existing run URLs continue to work. All listeners remain bound to `127.0.0.1`. There is no public-mode listener or account system.

Start the application you want to test separately. `PROBE_TARGET_URL` defaults to `http://localhost:3000/signup`. `PROBE_TARGET_ORIGINS` optionally lists exact approved loopback HTTP origins. URLs cannot contain credentials, query parameters, or fragments; metadata/private-network/public targets and Probe/TrueForge's control ports are excluded. `localhost` and `127.0.0.1` are separate origins, so configure the one your app actually uses. These settings only affect the new dashboard; the original full audit keeps its existing policy.

## Diagnose and pinpoint

**Scan page** opens a fresh anonymous Chromium context. It records a 1280×800 screenshot, visible DOM selectors/rectangles, and objective observations. It inspects form labels, accessible names, image alt text, document title/language, horizontal overflow, uncaught errors and HTTP 5xx responses. Missing CSP/nosniff headers are contextual hardening suggestions, not proof of exploitability.

The browser permits only same-origin GET/HEAD resources. Writes, external resources, WebSockets, service workers and consequential endpoints are blocked. The scan is bounded to 200 resource requests. These limits can affect the page; the result reports blocked requests and coverage limits. This scan does not submit forms or test signed-in workflows. Use the existing multi-agent audit for its supported real-account workflows.

Click the screenshot to choose a location, or focus it and use arrow keys/Enter. Coordinates are mapped to the smallest captured DOM element containing the point. Supply a prompt and choose **Investigate deeper**. Probe obtains a new screenshot and DOM observation, then sends the concern, pinpoint, page evidence and relevant personal memory to the configured TrueForge model. Screenshot coordinates refer to the earlier capture; the selector identifies the element to recheck. The agent receives no browser-write or arbitrary execution tools.

The same exact objective predicate in two separate browser captures is marked **Confirmed**. One capture is **Observed**; model inferences and contextual security suggestions remain **Suspected**. Provider failures leave captured findings accessible and mark the operation failed rather than claiming a completed investigation. A read-only capture cannot determine every behavioral defect; insufficient evidence is reported as such.

## Connect source and build a fix

Set these in `.env`, then restart Probe:

```dotenv
PROBE_SOURCE_ROOT=/absolute/path/to/your-app
# Optional overrides; JSON arrays of arguments, never shell strings:
PROBE_BUILD_COMMAND=["npm","run","build"]
PROBE_TEST_COMMAND=["npm","test"]
```

`PROBE_SOURCE_ROOT` is an operator-configured local Git repository, corresponding to the target app. The dashboard cannot select arbitrary filesystem paths or commands. TrueForge uses `TRUEFORGE_MODEL` and provider credentials configured in TrueForge Settings. Existing default package scripts are used when present. At least one build verification command is required; if there is no test command, the UI explicitly says tests were not run. Install your app's dependencies before using repairs.

1. Select a finding and click **Propose source fix**. The repository must have a clean working tree.
2. Probe selects up to 35 eligible tracked source files within a 140,000-character context budget. Only existing JS/TS/JSX/TSX/CSS/SCSS/HTML files are editable. Dotfiles, credentials, symlinks, generated/dependency directories and paths outside the root are excluded. Files with recognized credential literals are excluded from model context. The configured model receives this selected source; it is not a local model unless your TrueForge provider is local.
3. Model edits must match an exact, unique source span. Invalid syntax or unsupported paths fail the proposal. The dashboard shows the actual Git diff.
4. **Build fix** creates a detached disposable worktree at the recorded commit, links the app's installed `node_modules`, applies the proposed source, and runs the configured build/test commands. Each command has a three-minute deadline; logs/output are bounded. Commands use an argument array without a shell and a minimal environment; your target `.env` is not copied. Builds that depend on unavailable secrets/environment fail visibly. Only connect repositories whose build scripts you trust.
5. Build/test failure, changed source, a changed commit, cancelled work or tracked changes made by verification scripts prevent applying the patch. Probe rechecks hashes and cleanliness immediately before `git apply`.
6. A successful build applies the reviewed patch atomically to your original source, leaving an uncommitted diff for inspection. It does not push your target project or auto-restart/deploy your app. Reload/restart it, then **Rescan live page**. Build success is recorded separately from live defect verification.

Repairs are source edits, not dependency installation or arbitrary command generation. If the relevant source is absent from the bounded context, no valid patch can be produced. The original Fieldnotes **prepared-fix verification** remains its separate demo flow.

## Teach your personal agent

In any finished finding, enter a reason and choose **False positive** or **Real issue**. Feedback is scoped to origin, route, rule, selector and exact observation, so a different error on the same element is not silently dismissed. New matching findings carry the annotation while keeping their captured evidence. Relevant lessons are included in later investigation and repair prompts. A false-positive annotation prevents proposing/building that finding until it is accepted again.

The **Personal agent** tab shows lessons and a **Forget** action. Forgetting affects future matching/prompt context; historical feedback remains part of its original report. This is transparent persistent memory, not model fine-tuning or an automatic declaration that every similar observation is harmless.

## Stress testing and API limits

Stress tests accept **1–200 requests**, **1–5 concurrent workers**, and **1–10 total requests/second**. One dashboard/audit operation can run at a time. GET requests go only to the selected approved local URL; no redirects or retrying writes. Latencies include reading at most 256 KiB of each response. Each request times out after five seconds. An HTTP 429, HTTP 503, redirect, or at least 20% server/network failures after ten samples stops scheduling new requests; already-in-flight requests finish. Results retain partial measurements after cancellation. No 429 response at the tested load does not establish missing rate limiting.

The control server enforces fixed-window, per-socket-address limits:

| Surface | Limit |
| --- | --- |
| API requests | 600/minute |
| API mutations | 40/minute |
| Expensive job starts | 8/minute |
| MCP requests | 600/minute |
| Concurrent run SSE streams | 8 total |

HTTP 429 includes `Retry-After` and rate-limit headers. Forwarding headers are not trusted. Cancellation remains available when the expensive-start limit is reached. Limits reset on process restart and are deliberately process-local, matching the single local server. CSP, frame denial, nosniff, same-origin resource policy, referrer policy and cross-origin/Host checks protect the local control interface. Artifacts are served with sandboxed CSP and no-store caching.

## Persistence, cancellation, and testing

- `.data/workbench.sqlite`: jobs, findings, proposed diffs/build logs and scoped feedback.
- `.data/artifacts/workbench-<id>/`: private screenshot evidence.
- `.data/repairs/`: temporary Git worktrees, removed after completion/failure.
- Interrupted running jobs become failed on restart; evidence survives. If interruption occurs during final source application, inspect the source diff and rerun verification.
- Cancellation closes Chromium, cancels model sessions, aborts stress requests and terminates verification subprocess groups. Once the short final atomic `git apply` begins, it finishes and the result records that application; it is never relabeled as unapplied.

```sh
npm test
npm run build
npm run verify:workbench
```

The workbench integration verification launches a real loopback Probe server, real Chromium and a temporary target repository. It checks scan → pinpoint → investigate → feedback persistence → propose → isolated build/tests → source apply → live rescan, plus stress boundaries, forgetting lessons and mobile layout. It uses a deterministic **TrueForge protocol fixture**, not a live provider or a claim of model quality. Reports/screenshots are written beneath `.data/verification/workbench-*`. Live provider execution requires the user's configured TrueForge service and credentials.
