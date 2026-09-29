# Repository-free automation validation

**Date:** 2026-09-29
**PRs:** [#31](https://github.com/mikoagents/miko/pull/31), [#32](https://github.com/mikoagents/miko/pull/32)
**Test repository:** `/private/tmp/miko-pr32-f1-20260929`

## Automated checks

- Full workspace tests: 2,312 passed, two skipped after integrating #31.
- Full build, workspace typecheck, and Biome CI passed (existing warnings remain).
- Regression coverage verifies existing Linear project assignments survive editing,
  workspace/team changes clear stale associations, and switching between Ops and
  repository modes derives the correct workspace.
- Operations tests cover an installation with no repositories, native Linear MCP
  configuration, the configured tool allowlist, Claude/Codex/Cursor sandbox
  configuration, runner failures, persistence, and success without a PR.
- The missing MCP configuration and widened tool allowlist were reproduced with
  failing tests before the fixes. Development tasks still require a verified PR
  or a reasoned no-change outcome.

## F1 protocol

1. Created a fresh fixture with `f1 init-test-repo` and started the F1 server on
   port 3600. Both `ping` and `status` passed.
2. Created a paused `direct_ops` automation without `repositoryId`, selecting
   Claude with `claude-sonnet-4-6`. Manually triggered it once.
3. Run `55847ba2-4e84-4d52-92bd-9407424d0851` used a plain directory under the
   temporary Miko home's `automation-workspaces/`, confirmed there was no `.git`,
   wrote `ops-result.txt`, and read it back. Independent filesystem verification
   confirmed the exact bytes `F1_OPS_OK\n` and the absence of `.git`.
4. The run reached `succeeded` after one attempt with `prUrls: []`. Its saved
   snapshot retained `direct_ops`, the selected agent/model, and no repository.
5. Created local tracker issue `DEF-1` with explicit repository, agent, and model
   selectors. `session-1` produced four timestamped activities, including routing
   and the final response `F1 issue routing still works.`
6. `view-session --limit 10 --offset 0` rendered the activities coherently.
   Stopped the issue session, archived the paused automation, and shut down F1.
7. Reopened the real automation store after shutdown and verified the successful
   run, single attempt, absent repository, empty PR list, and archived definition.
8. The fixture repository remained unchanged. No production schedules or external
   issues were modified.

## UI verification and limits

The browser's task view displayed the operations task, Bash/Write/Read activity,
and final response. The full Automations form visual check could not be completed:
the browser API failed to initialize, and native browser control repeatedly
stalled. Form serialization and mode transitions are covered by automated tests.
Live Linear mutations were not performed; MCP configuration is verified with
unit tests and the F1 drive used only its own local test directory.
