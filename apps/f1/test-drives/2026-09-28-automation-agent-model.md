# Automation agent and model PR validation

**Date:** 2026-09-28
**PR:** [#30](https://github.com/mikoagents/miko/pull/30)
**Test repository:** `/private/tmp/miko-pr30-f1-20260928`

## Automated checks

- Full build, workspace typecheck, and Biome CI passed.
- All workspace test suites passed: 2,272 passing tests and two skipped tests,
  including 1,022 edge-worker tests and 132 CLI tests.
- Four regression tests failed before the fixes and passed afterward: clearing
  legacy selections, retaining a legacy runner when changing only the model,
  keeping the configured default runner with a model override, and rejecting
  model values that inject routing tags. Linear issue dispatch is also covered.

## F1 protocol

1. Created a fresh fixture and started F1 on port 3600 with
   `MIKO_DEFAULT_RUNNER=codex`. `ping` and `status` passed.
2. The automation options API returned `defaultRunner: codex`, the supported
   runners, and model suggestions.
3. Created a paused direct automation with `runner: claude` and
   `model: claude-sonnet-4-6`; manually ran it once. Its instructions requested
   only reading the fixture README, with no edits or external publishing.
4. Run `a9aa774c-4d0a-4301-83c5-412943d63355` created its isolated worktree,
   read the README, returned its heading, and reached `succeeded` after one
   attempt. Its saved snapshot retained the selected runner/model; the board
   recorded the task as completed using `claude-sonnet-4-6`.
5. Created and started a local tracker issue with explicit repository, agent,
   and model selectors. `session-1` produced four timestamped activities,
   including a final `F1 agent selection received.` response. Paginated
   `view-session --limit 10 --offset 0` rendered coherent output.
6. Stopped the issue session, archived the paused automation, and shut down
   the isolated server. No production schedules or external issues were used.

## Limits

Live Linear delegation was not performed; exact issue payloads are verified by
adapter tests. Browser visual verification was unavailable because the browser
automation service could not start. Board status/skills and their earlier F1
validation are recorded in `2026-09-28-board-pr-review.md`.
