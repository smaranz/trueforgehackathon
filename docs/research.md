# API research notes

Official sources read: the repository README, introduction, create-agent overview, capabilities overview, subagents, sessions, SDK quickstart, and use-agent cookbook linked from README.

- `webcmd web fetch --url https://trueforge.dev/introduction` returned `FETCH_BLOCKED`.
- The supported browser fallback `webcmd web fetch-browser --url https://trueforge.dev/introduction` succeeded.
- `webcmd web fetch --url https://github.com/truefoundry/trueforge` was blocked; the dedicated fetch tool retrieved the repository and remaining official pages successfully.
- Local/registry Rote play search found no matching reusable project workflow. Build/test work used the local TypeScript toolchain.
- The introduction contained an older core-package SDK reference; the current SDK quickstart and installed package identify `@truefoundry/trueforge-sdk`.
- Installed `@truefoundry/trueforge-sdk` and CLI: **0.2.0**. Inspected generated declarations for the root client, session/turn APIs, runtime spec, configured models and Settings MCP connector creation, including header auth.
- Confirmed via installed CLI help/source that `HOST` controls binding and only `--port` is supported on the command line.
- SDK session creation and actual MCP initialization were exercised against the local TrueForge server. The real model turn failed with HTTP 401 from the configured OpenAI provider. That error was persisted as an Inconclusive run with no finding.
- After the user selected `openai/gpt-5-6-sol`, the complete real agent flow succeeded: four turns, scoped MCP browser actions, evidence-backed observations, clean reproduction and the unchanged before/after regression. The historical 401 was not relabeled or discarded.

No invented resume, browser-isolation or replay API is used. Cross-account isolation, application SSE replay-from-persisted-snapshot, clean reproduction and regression generation are explicit application code.
