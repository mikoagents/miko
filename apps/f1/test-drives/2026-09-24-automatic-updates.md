# Test Drive: automatic updates wait for real work

**Date**: 2026-09-24
**Base**: `6618e57a` (latest `mikoagents/miko` main when development began)
**Goal**: Verify the production update IPC protocol against a real F1 EdgeWorker and agent session.
**Test repo**: `/private/tmp/miko-update-f1-20260924` (fresh F1 repository, no remote)
**Port**: 3600; isolated F1 config home, no production service changes.

## Issue-tracker verification

- [x] `f1 init-test-repo`, `f1 ping`, and `f1 status` succeeded.
- [x] Created `issue-1` / `DEF-1`, explicitly routed with `[repo=f1-test-repo]`.
- [x] Started `session-1`; the task requested a read-only 20-second wait followed by reading README.md.
- [x] The real Claude runner produced `UPDATE_F1_OK` and a correct repository summary.

## Worker verification

- [x] F1 used the same `registerManagedUpdates` IPC controller as the production CLI.
- [x] While the agent executed `sleep 20`, `/status` returned `busy`.
- [x] The parent sent `miko:prepare-update`; the worker returned `accepted: false` and kept running.
- [x] The agent completed normally after the rejected restart request.
- [x] `/status` then returned `idle`; after `f1 stop-session`, the same request returned `accepted: true`.
- [x] The worker saved state and exited with code 0.
- [x] A second F1 process started with `MIKO_UPDATE_TRIAL=1`. It reported IPC readiness but returned HTTP 503 while task admission was paused.
- [x] `miko:activate-update` received `miko:activated`; `/status` returned HTTP 200 with `idle` afterwards.
- [x] The second process stopped cleanly. No unhandled application error was observed.

## Activity verification

- [x] `view-session --limit 10 --offset 0` returned seven timestamped activities.
- [x] Activities included routing/model thoughts, Bash/Read actions, and the final response.
- [x] The local board snapshot endpoint returned a valid snapshot with service state, tasks, and logs.
- [ ] Browser rendering and search were not exercised; this change adds no board UI.

## Protocol evidence

```text
miko:ready autoUpdate=true
miko:prepare-update during real task -> accepted=false
final response -> UPDATE_F1_OK
/status -> idle
miko:prepare-update after task -> accepted=true
worker exit -> 0

candidate trial: miko:ready
GET /status -> 503
miko:activate-update -> miko:activated
GET /status -> 200 {"status":"idle"}
```

## Additional validation

The Node installer/supervisor regression suite uses actual child processes and temporary release directories. It covers busy-to-idle activation, network/build failure, candidate startup failure and rollback, interrupted activation recovery, version pins, unchanged remote heads, cancellation, concurrent-install locks, and launcher argument forwarding. Skill tests cover unchanged/default updates, custom content/files/symlinks/deletions, legacy migration, and rollback.

F1 validates the real task admission and shutdown boundaries. The supervisor regression tests use a controlled remote/build adapter, so they do not claim to validate a live GitHub download or pnpm build during an upgrade.
