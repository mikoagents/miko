# Miko Hub

Miko Hub is the self-hosted open-source automation layer for Miko (`mikoagents/miko-daemon`) execution daemons.

This repository contains the open-source Hub codebase. Its Fly files contain only the minimal,
non-secret deployment wiring. Credentials, private workflow configuration, and operational
runbooks for privately operated instances must not live here.

The optional billing integration in `src/billing/` is inert without `STRIPE_SECRET_KEY`; instances without billing configuration expose no billing surface. See `docs/entitlements.md` and `docs/billing.md`.

Public docs live in `getpaseo/paseo` under `public-docs/`. Follow the documentation criteria in `MAINTAINERS.md` before opening a companion PR.

Repository verification, release, cross-repository compatibility, and documentation procedures
live in `MAINTAINERS.md`.

# Repository workflow

This repository is independently maintained and is detached from GitHub’s fork network. Develop
and integrate changes against `mikoagents/miko` and its `main` branch first; contributing selected
changes upstream is secondary.

`origin` points to `https://github.com/mikoagents/miko.git`; `upstream` points to
`https://github.com/getpaseo/hub.git`. The `upstream` remote records the original source and supports
manual synchronization; GitHub no longer maintains a fork relationship. Upstream PRs and companion
documentation PRs are not prerequisites for Miko-only changes. When preparing an upstream contribution, use a focused
branch and follow the upstream maintenance and documentation procedures.

# Product Vision

Miko Hub is an open, self-hosted coordination layer for the agents users already run.

It connects conversations and events from services such as GitHub, Slack, and Discord to configurable, multi-step agent workflows without taking ownership of the user's code, credentials, infrastructure, or security model.

Hub provides explicit building blocks: triggers, routing, environments, provider settings, credentials, context, outputs, and completion contracts. Workflow authors decide which building blocks each step receives and how they are composed. Hub must never silently broaden permissions, inject context, rewrite prompts, or impose a particular way of working.

Provider-specific capabilities remain provider-specific. Miko Hub validates and passes them through faithfully, allowing users to rely on each provider's native sandboxing, permission modes, models, and documented behavior rather than learning lossy Miko Hub abstractions.

The goal is to make sophisticated agent workflows easy to assemble while keeping authority visible, configuration portable, and control with the operator. Defaults should make common workflows straightforward, but every consequential behavior must remain explicit and optional.

# Project Status

This is a project in early-development, take advantage of not needing to implement back compat shims, do clear cuts and hard refactors.

# UI work

`docs/design.md` is the visual contract for every `.tsx` file, `src/styles.css`, and everything under
`src/components`. It is loaded with this file. Follow it; `src/typography-policy.test.ts` enforces the
mechanical parts.

# Trigger Pipeline contract

Every new or changed Trigger must declare a high-quality `pipeline` in its code. Keep the graph in
sync with `run(ctx)` at the level of core operator-facing phases, not one node per API call. Group
locks, pagination, labels and cleanup into their owning phase; keep implementation details in its
description/tooltip. Merge event receipt, preflight reads and readiness checks into one admission
node when they express the same condition; put result choices on outgoing edges where possible.
Compactness must not erase distinct business actions or consequential conditions. Keep publication
and remote verification distinguishable; distinguish waiting from skipping, and show continuation,
external blockers and exhausted limits on their actual paths. Choose nodes by meaning, not a fixed
node count; avoid a second node that merely restates the preceding action's result.
Restore meaningful business phases as explicit nodes when simplifying would hide them: CI gates,
review deduplication, workspace preparation, evidence snapshots, repair-input claims, budget checks,
checkpoint persistence and completion decisions. Node cards show only names and recorded status;
descriptions stay in tooltips. Do not replace missing nodes with expanded description text.
Declare housekeeping in `supportOperations` so it stays in diagnostics without creating nodes or
falsely advancing business-stage progress. Admission and final action nodes may bind operations.
Name each phase with a concrete action and object (for example, “Publish GitHub
Review”), and each decision with the condition it checks (“CI finished?”). Avoid umbrella labels
such as “Check conditions”, “Execute” or “Finish” that hide what the workflow does. Use stable IDs,
precise labels and descriptions, explicit actions and waits,
labelled conditions and parallel lanes, joins, early exits, outcomes and bounded retry loops.
Bind executable nodes to exact durable operation IDs or non-overlapping literal prefixes ending
in `*`; name loop operations by stage first. Mark and label return edges with `loop: true`.
Trigger and Activity share this definition and renderer; Activity uses its accepted revision and
adds recorded operation status without inferring decisions. Do not add Mermaid diagrams or a
second graph renderer. See `docs/programmable-triggers.md` for the authoring and validation contract.
