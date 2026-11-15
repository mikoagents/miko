import { TRIGGER_TEMPLATES } from "./template-catalog.js";
import type {
  TriggerManifest,
  TriggerSubscription,
  TriggerTemplateReference,
  TriggerPipeline,
} from "./sdk.js";
import { compareTemplateVersions } from "./template-version.js";
import { TEMPLATE_RUNTIME } from "./template-runtime.js";

export const TRIGGER_TEMPLATE_CATEGORIES = [
  { value: "code-quality", label: "Code quality" },
  { value: "security", label: "Security" },
  { value: "devops", label: "DevOps" },
  { value: "team", label: "Team" },
  { value: "business", label: "Product & business" },
] as const;

export type TriggerTemplateCategory = (typeof TRIGGER_TEMPLATE_CATEGORIES)[number]["value"];

export interface TriggerTemplate {
  id: string;
  category: TriggerTemplateCategory;
  version: string;
  name: string;
  description: string;
  sourceUrl: string;
  prompt: string;
  schedule: { rule: string; label: string; cron: string } | null;
  trigger: {
    kind:
      | "schedule"
      | "pull_request"
      | "review_comment"
      | "ci_failure"
      | "workflow_failure"
      | "slack_message"
      | "linear_issue"
      | "sentry_issue"
      | "pagerduty_incident";
    source: string;
    events: string[];
    label: string;
    transport: "native" | "bridge";
    ignoreDrafts?: boolean;
    conclusions?: string[];
  };
  requiresRepository: boolean;
  multipleRepositories: boolean;
  writesCode: boolean;
  requiresMemory: boolean;
  notifySlack: boolean;
  slackMode: "thread" | "channel";
  requiredMcp: string[];
  tools: string[];
  githubPermissions: Record<string, "read" | "write">;
  inputs: { key: string; label: string; description: string; kind: "text" | "list" }[];
  setupNotes: string[];
  upstreamWorkflow: {
    triggers: Record<string, unknown>[];
    actions: Record<string, unknown>[];
    memoryEnabled: boolean;
    gitConfig?: { branch: string };
  };
}

export { TRIGGER_TEMPLATES };

/** The initial editable project's configuration, with the same explicit placeholders as its source. */
export function triggerTemplateManifest(
  template: TriggerTemplate,
  name = template.id,
): TriggerManifest {
  const on: TriggerSubscription[] = [{ source: "manual", event: "run" }];
  if (template.schedule !== null) {
    on.push({
      source: "schedule",
      event: "tick",
      recurrence: { timezone: "UTC", start: "1970-01-01T00:00:00", rule: template.schedule.rule },
    });
  } else {
    const subscription: TriggerSubscription = {
      source: template.trigger.source,
      event: [...template.trigger.events],
    };
    if (template.trigger.source === "github") {
      subscription.connection = "your-github-connection";
      subscription.resource = "owner/repo";
    } else if (template.trigger.source === "linear")
      subscription.connection = "your-linear-connection";
    on.push(subscription);
  }
  let target = "workspace";
  if (template.requiresRepository)
    target = template.multipleRepositories ? "repository-0" : "repository";
  return {
    name,
    template: { id: template.id, version: template.version },
    description: template.description,
    pipeline: automationPipeline(template),
    runner: "local",
    on,
    grants: {
      targets: {
        [target]: {
          daemon: "your-daemon",
          cwd: template.requiresRepository
            ? "/path/to/repository"
            : "/path/to/automation-workspace",
          providers: ["codex"],
        },
      },
      ...(template.requiresRepository
        ? {
            github: {
              repository: {
                connection: "your-github-connection",
                repositories: ["owner/repo"],
                permissions: template.githubPermissions,
              },
            },
          }
        : {}),
      secrets: template.notifySlack ? ["SLACK_BOT_TOKEN"] : [],
    },
    limits: { maxRuntime: "1h", maxAgentRuns: 1 },
  };
}

export function findTriggerTemplate(id: string | undefined): TriggerTemplate | undefined {
  return TRIGGER_TEMPLATES.find((template) => template.id === id);
}

export function triggerTemplateStatus(reference: TriggerTemplateReference) {
  const latest = findTriggerTemplate(reference.id);
  const comparison =
    latest === undefined ? null : compareTemplateVersions(reference.version, latest.version);
  let status: "unknown" | "update_available" | "newer" | "current" = "unknown";
  if (comparison === 0) status = "current";
  else if (comparison !== null && comparison < 0) status = "update_available";
  else if (comparison !== null && comparison > 0) status = "newer";
  return {
    id: reference.id,
    name: latest?.name ?? reference.id,
    installedVersion: reference.version,
    latestVersion: latest?.version ?? null,
    sourceUrl: latest?.sourceUrl ?? null,
    status,
  } as const;
}

/** Both the CLI and the web guide produce this native, editable project. */
export function triggerTemplateSource(template: TriggerTemplate, name = template.id): string {
  const ci = template.trigger.kind === "ci_failure";
  const integration = {
    eventKind: template.trigger.kind,
    requiresRepository: template.requiresRepository,
    ignoreDrafts: template.trigger.ignoreDrafts ?? false,
    conclusions: template.trigger.conclusions ?? [],
    memoryEnabled: template.requiresMemory,
    notifySlack: template.notifySlack,
    slackMode: template.slackMode,
    allowSlackReplies: template.id === "build-healthcheck",
    requiredMcp: template.requiredMcp,
    sourceActions: template.upstreamWorkflow.actions,
  };
  let repositories = "[]";
  if (template.requiresRepository)
    repositories =
      '[{ name: settings.repository, cwd: settings.cwd, branch: settings.branch, target: "repository" }]';
  if (template.multipleRepositories)
    repositories =
      'settings.repositories.map((repo, index) => ({ ...repo, target: "repository-" + index }))';
  const native = templateSubscriptions(template);
  const targets = template.requiresRepository
    ? "Object.fromEntries(repositories.map((repo) => [repo.target, { daemon: settings.daemon, cwd: repo.cwd, providers: [settings.provider] }]))"
    : "{ workspace: { daemon: settings.daemon, cwd: settings.cwd, providers: [settings.provider] } }";
  const github = template.requiresRepository
    ? `github: { repository: { connection: settings.connection, repositories: repositories.map((repo) => repo.name), permissions: ${JSON.stringify(template.githubPermissions)} } },`
    : "";
  const worktree = template.requiresRepository
    ? `
        github: "repository",
        worktree: context.pullRequestNumber === null
          ? { mode: "branch-off", base: context.repository!.branch, newBranch: ${JSON.stringify("automation/" + name + "-")} + ctx.runId }
          : { mode: "checkout-pr", prNumber: context.pullRequestNumber },`
    : "";
  const outputs =
    template.id === "linear-issue-triage" ? ' outputs: { "linear.reply": { max: 1 } },' : "";
  return `// Adapted from Cursor Automations: ${template.sourceUrl}
import { defineTrigger, type TriggerAgentOptions, type TriggerContext } from "@mikoagents/hub/triggers";

// Fill these values before deploying. Credentials stay outside the project.
// Required native MCP servers: ${template.requiredMcp.join(", ") || "none"}.
${template.setupNotes.map((note) => "// " + note).join("\n")}
const settings = {
  ${templateSettings(template).join(",\n  ")},
};

// Original Cursor prompt, preserved verbatim.
const originalPrompt = ${templateLiteral(template.prompt)};
const integration: Integration = { ...${JSON.stringify(integration, null, 2)}, ignoreBotMessages: ${template.trigger.kind === "slack_message" ? "settings.ignoreBotMessages" : "false"} };
const repositories: RepositoryTarget[] = ${repositories};
const extraInputs = settings.inputs;
const slackDestination: string | null = ${template.notifySlack || template.trigger.kind === "slack_message" ? "settings.slackChannel" : "null"};

export default defineTrigger({
  name: ${JSON.stringify(name)},
  template: ${JSON.stringify({ id: template.id, version: template.version })},
  description: ${JSON.stringify(template.description)},
  pipeline: ${JSON.stringify(automationPipeline(template), null, 2)},
  runner: settings.runner,
  on: ${native},
  grants: {
    targets: ${targets},
    ${github}
    secrets: ${JSON.stringify(template.notifySlack ? ["SLACK_BOT_TOKEN"] : [])},
  },
  limits: { maxRuntime: "1h", maxAgentRuns: 1 },
  async run(ctx) {
    return ctx.withLock("automation", "automation", async () => {
      const context = await taskContext(ctx);
      const memory = ${template.requiresMemory ? 'await ctx.state.get<Record<string, string>>("read-memory", "memory") ?? {}' : "{}"};
      const result = await ctx.agent.run<AutomationResult>("automation", {
        target: context.target,
        agent: { provider: settings.provider, ...settings.agentOptions },${worktree}
        title: ${JSON.stringify(template.name)},
        prompt: [context.prompt, originalPrompt, hubInstructions, JSON.stringify(memory)].join("\\n\\n"),
        maxRuntime: "50m", idleTimeout: "10m",${outputs}
        output: { schema: resultSchema },
      });
      const notified = await deliverSlack(ctx, context, result.output);
      ${template.requiresMemory ? 'await ctx.state.set("save-memory", "memory", result.output.memory);' : "// Persistent memory is disabled by this template."}
      return { notified, summary: result.output.summary };
    });
  },
});
${TEMPLATE_RUNTIME}
${ci ? CI_SOURCE : 'async function ciContext(_ctx: TriggerContext): Promise<string> { throw new Error("CI admission is not enabled for this template."); }\n'}`;
}

function templateSettings(template: TriggerTemplate): string[] {
  const extraInputs = Object.fromEntries(
    template.inputs
      .filter((input) => !["repo", "repos", "slack_channel"].includes(input.key))
      .map((input) => [input.key, input.kind === "list" ? [] : ""]),
  );
  const settings = [
    'runner: "local"',
    'daemon: "your-daemon"',
    'provider: "codex"',
    'agentOptions: {} as Omit<TriggerAgentOptions["agent"], "provider">',
  ];
  if (!template.multipleRepositories)
    settings.push(
      `cwd: ${JSON.stringify(template.requiresRepository ? "/path/to/repository" : "/path/to/automation-workspace")}`,
    );
  if (template.requiresRepository) {
    settings.push('connection: "your-github-connection"');
    if (template.multipleRepositories)
      settings.push(
        'repositories: [{ name: "owner/repo", cwd: "/path/to/repository", branch: "main" }]',
      );
    else settings.push('repository: "owner/repo"', 'branch: "main"');
  }
  if (template.trigger.kind === "linear_issue")
    settings.push('linearConnection: "your-linear-connection"');
  if (template.trigger.kind === "slack_message") settings.push("ignoreBotMessages: true");
  if (template.notifySlack || template.trigger.kind === "slack_message")
    settings.push('slackChannel: "your-slack-channel-id"');
  settings.push("inputs: " + JSON.stringify(extraInputs, null, 2));
  return settings;
}

function templateSubscriptions(template: TriggerTemplate): string {
  const manual = '{ source: "manual", event: "run" }';
  if (template.schedule !== null) {
    const recurrence = {
      timezone: "UTC",
      start: "1970-01-01T00:00:00",
      rule: template.schedule.rule,
    };
    const subscriptions: TriggerSubscription[] = [
      { source: "manual", event: "run" },
      { source: "schedule", event: "tick", recurrence },
    ];
    return JSON.stringify(subscriptions, null, 2);
  }
  const events = JSON.stringify(template.trigger.events);
  if (template.trigger.source === "github")
    return `[${manual}, ...repositories.map((repo) => ({ source: "github", event: ${events}, connection: settings.connection, resource: repo.name }))]`;
  if (template.trigger.source === "linear")
    return `[${manual}, { source: "linear", event: ${events}, connection: settings.linearConnection }]`;
  return `[${manual}, { source: ${JSON.stringify(template.trigger.source)}, event: ${events} }]`;
}

function automationPipeline(template: TriggerTemplate): TriggerPipeline {
  const ci = template.trigger.kind === "ci_failure";
  const operations: string[] = [];
  if (ci) operations.push("find-failed-ci", "ci-jobs*", "read-ci-claim", "claim-ci");
  if (template.trigger.kind === "pull_request" || template.trigger.kind === "review_comment")
    operations.push("read-pull");
  if (template.trigger.kind === "workflow_failure") operations.push("find-failed-workflow");
  const admission = template.schedule === null;
  const first = template.requiresMemory ? "memory" : "agent";
  const after = template.requiresMemory ? "save" : "release";
  const nodes: TriggerPipeline["nodes"] = [
    {
      id: "event",
      kind: "event",
      label: template.trigger.label,
      description: "Receive the configured event or an explicit manual request.",
    },
    {
      id: "lock",
      kind: "wait",
      label: "Serialize automation",
      description: "Wait for the prior run before reading or updating workflow state.",
      operations: ["automation:acquire"],
    },
    {
      id: "agent",
      kind: "agent",
      label: "Run automation",
      description:
        "Run the complete original prompt with its configured native tools and event context.",
      operations: ["automation"],
    },
    {
      id: "release",
      kind: "step",
      label: "Release automation",
      description: "Release this Trigger's execution lock.",
      operations: ["automation:release"],
    },
    {
      id: "done",
      kind: "outcome",
      label: "Automation complete",
      description: "Return the summary and whether a notification was delivered.",
    },
  ];
  const edges: TriggerPipeline["edges"] = [{ from: "event", to: "lock" }];
  let previous = "lock";
  if (operations.length > 0) {
    nodes.push({
      id: "context",
      kind: "step",
      label: "Read event context",
      description:
        "Read the canonical pull request or bounded workflow details needed for this event.",
      operations,
    });
    edges.push({ from: previous, to: "context" });
    previous = "context";
  }
  if (admission) {
    nodes.push(
      {
        id: "eligible",
        kind: "decision",
        label: "Eligible event?",
        description:
          "Check the configured repository, draft/CI rules or Slack channel before dispatch.",
      },
      {
        id: "skip",
        kind: "outcome",
        label: "Skip",
        description: "No eligible event needs work, or a matching CI failure was recently claimed.",
      },
    );
    edges.push(
      { from: previous, to: "eligible" },
      { from: "eligible", to: first, label: "Eligible event" },
      { from: "eligible", to: "skip", label: "Excluded or already claimed" },
    );
  } else edges.push({ from: previous, to: first });
  if (template.requiresMemory) {
    nodes.push(
      {
        id: "memory",
        kind: "step",
        label: "Read memory",
        description: "Load the durable named-file snapshot.",
        operations: ["read-memory"],
      },
      {
        id: "save",
        kind: "step",
        label: "Save memory",
        description: "Persist the new snapshot after required delivery succeeds.",
        operations: ["save-memory"],
      },
    );
    edges.push({ from: "memory", to: "agent" }, { from: "save", to: "release" });
  }
  if (template.notifySlack) {
    nodes.push(
      {
        id: "notify",
        kind: "decision",
        label: "Message to deliver?",
        description:
          "Deliver a non-empty final message or stay silent as the original prompt requires.",
      },
      {
        id: "publish",
        kind: "step",
        label: template.slackMode === "thread" ? "Reply in Slack thread" : "Deliver to Slack",
        description: "Require a successful receipt before saving findings as reported.",
        operations: ["post-slack"],
      },
    );
    edges.push(
      { from: "agent", to: "notify" },
      { from: "notify", to: "publish", label: "Message returned" },
      { from: "notify", to: after, label: "Stay silent" },
    );
    if (template.id === "build-healthcheck") {
      nodes.push(
        {
          id: "threaded",
          kind: "decision",
          label: "Investigation reply?",
          description: "A failed build includes a threaded read-only investigation.",
        },
        {
          id: "replies",
          kind: "step",
          label: "Post investigation",
          description: "Use the actual parent receipt for each bounded thread reply.",
          operations: ["post-slack-reply:*"],
        },
      );
      edges.push(
        { from: "publish", to: "threaded" },
        { from: "threaded", to: "replies", label: "Replies returned" },
        { from: "threaded", to: after, label: "No followups" },
        { from: "replies", to: after },
      );
    } else edges.push({ from: "publish", to: after });
  } else edges.push({ from: "agent", to: after });
  edges.push({ from: "release", to: "done" });
  return { nodes, edges };
}

function templateLiteral(value: string): string {
  return "`" + value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${") + "`";
}

const CI_SOURCE = String.raw`
async function ciContext(ctx: TriggerContext): Promise<string> {
  type Workflow = { id: number; head_branch: string; conclusion: string; html_url: string };
  let workflow: Workflow | undefined;
  if (ctx.event.source === "github") {
    workflow = (ctx.event.payload as { workflow_run?: Workflow } | null)?.workflow_run;
  } else {
    const recent = await ctx.github.request<{ workflow_runs: Workflow[] }>("find-failed-ci", "repository", {
      method: "GET",
      path: "/repos/" + settings.repository + "/actions/runs?status=failure&branch=" + encodeURIComponent(settings.branch) + "&per_page=1",
    });
    workflow = recent.workflow_runs[0];
  }
  if (!workflow || workflow.conclusion !== "failure" || workflow.head_branch !== settings.branch) {
    ctx.skip("No failed CI run on the configured branch.");
  }
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1) throw new Error("Invalid workflow run id");
  const jobs = await ctx.github.paginate<{ name: string; conclusion: string; html_url: string }>(
    "ci-jobs", "repository", {
      path: "/repos/" + settings.repository + "/actions/runs/" + workflow.id + "/jobs",
      itemsKey: "jobs", maxPages: 10, maxItems: 1000,
    },
  );
  const failed = jobs.filter((job) => job.conclusion === "failure");
  if (failed.length === 0) ctx.skip("No failing CI jobs.");
  const key = ("ci-fail-" + failed.map((job) => job.name).sort().join("_").replace(/[^a-zA-Z0-9._-]/g, "")).slice(0, 64);
  const claimedAt = await ctx.state.get<string>("read-ci-claim", key);
  if (claimedAt && Date.parse(ctx.startedAt) - Date.parse(claimedAt) < 30 * 60 * 1000) {
    ctx.skip("Another run claimed these CI failures in the last 30 minutes.");
  }
  await ctx.state.set("claim-ci", key, ctx.startedAt);
  return "## CI Status Report\n" + JSON.stringify({ repository: settings.repository, workflow, jobs: failed }, null, 2);
}
`;
