import { defineTrigger } from "@mikoagents/hub/triggers";
import { policy } from "./policy.js";
import { reviewPullRequest } from "./review.js";

export default defineTrigger({
  name: "github-review",
  description: "Wait for CI, review, repair findings and independently review the new head.",
  pipeline: {
    nodes: [
      {
        id: "event",
        kind: "event",
        label: "PR or CI event",
        description: "Receive a subscribed PR event or an on-demand run.",
      },
      {
        id: "eligible",
        kind: "decision",
        label: "Eligible PR and new head?",
        description:
          "Resolve the PR, serialize candidates, check author, head and durable ownership.",
        operations: [
          "resolve-workflow-pr",
          "pull-request:acquire",
          "candidate:*",
          "claim:*",
          "clear-label:*",
        ],
      },
      {
        id: "skip",
        kind: "outcome",
        label: "Skip candidate",
        description: "Ignore ineligible, stale, changed or already-owned candidates.",
      },
      {
        id: "ci",
        kind: "wait",
        label: "Wait for CI",
        description: "Read current workflow runs and await relevant CI events.",
        operations: ["ci:*"],
      },
      {
        id: "passed",
        kind: "decision",
        label: "CI passed?",
        description: "Review passing candidates; repair failures within the configured budget.",
      },
      {
        id: "budget",
        kind: "decision",
        label: "Repair budget available?",
        description: "Enforce round and consecutive bot commit limits.",
        operations: ["budget:*"],
      },
      {
        id: "stop",
        kind: "outcome",
        label: "Stop with reason",
        description: "Record exhausted limits, invalid receipts or failed verification.",
      },
      {
        id: "fix",
        kind: "agent",
        label: "Repair and push",
        description: "Repair failing CI or formal Review findings and push a new head.",
        operations: ["repair:*"],
      },
      {
        id: "review",
        kind: "agent",
        label: "Publish formal Review",
        description: "Independently review the accepted head and return an actual receipt.",
        operations: ["review:*"],
      },
      {
        id: "receipt",
        kind: "step",
        label: "Verify Review receipt",
        description: "Read back the formal Review, author, head and inline comment count.",
        operations: ["receipt:*"],
      },
      {
        id: "complete",
        kind: "decision",
        label: "Validation complete?",
        description: "Repeat supplemental verification while the Review remains incomplete.",
      },
      {
        id: "verify",
        kind: "agent",
        label: "Supplement validation",
        description: "Wait for CI, run missing checks and publish a replacement Review.",
        operations: ["verification:*"],
      },
      {
        id: "findings",
        kind: "decision",
        label: "Unresolved findings?",
        description: "Check the candidate still matches and inspect the verified Review.",
        operations: ["after-review:*"],
      },
      {
        id: "save",
        kind: "step",
        label: "Record completed Review",
        description: "Save the receipt, apply the completion label and release the PR lock.",
        operations: ["save:*", "complete-label:*", "pull-request:release"],
      },
      {
        id: "done",
        kind: "outcome",
        label: "Review complete",
        description: "Return the accepted head and published Review URL.",
      },
    ],
    edges: [
      { from: "event", to: "eligible" },
      { from: "eligible", to: "skip", label: "Ineligible or stale" },
      { from: "eligible", to: "ci", label: "Eligible new head" },
      { from: "ci", to: "passed" },
      { from: "passed", to: "budget", label: "CI failed" },
      { from: "passed", to: "review", label: "CI passed" },
      { from: "budget", to: "stop", label: "Limit reached" },
      { from: "budget", to: "fix", label: "Budget available" },
      { from: "fix", to: "eligible", label: "New head", loop: true },
      { from: "review", to: "receipt" },
      { from: "receipt", to: "complete" },
      { from: "complete", to: "verify", label: "Incomplete validation" },
      { from: "complete", to: "findings", label: "Validation complete" },
      { from: "verify", to: "receipt", label: "Replacement Review", loop: true },
      { from: "findings", to: "budget", label: "Findings remain" },
      { from: "findings", to: "skip", label: "Candidate changed" },
      { from: "findings", to: "save", label: "No findings" },
      { from: "save", to: "done" },
    ],
  },
  runner: policy.runner,
  on: [
    {
      source: "github",
      connection: policy.connection,
      resource: policy.repository,
      event: [
        "pull_request.*",
        "pull_request_review.*",
        "workflow_run.completed",
        "check_suite.completed",
      ],
    },
    { source: "manual", event: "run" },
  ],
  grants: {
    targets: {
      repository: { daemon: policy.daemon, cwd: policy.cwd, providers: [policy.agent.provider] },
    },
    github: {
      review: {
        connection: policy.connection,
        repositories: [policy.repository],
        permissions: {
          contents: "read",
          pull_requests: "write",
          issues: "write",
          actions: "read",
          checks: "read",
        },
      },
      repair: {
        connection: policy.connection,
        repositories: [policy.repository],
        permissions: {
          contents: "write",
          pull_requests: "write",
          issues: "write",
          actions: "read",
          checks: "read",
        },
      },
    },
  },
  limits: { maxRuntime: "12h", maxAgentRuns: 20 },
  run: reviewPullRequest,
});
