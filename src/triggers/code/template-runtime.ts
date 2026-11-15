/** Self-contained helpers embedded in authored projects; no server-side runtime is injected. */
export const TEMPLATE_RUNTIME = String.raw`
interface Integration {
  eventKind: string; requiresRepository: boolean; ignoreDrafts: boolean; conclusions: string[];
  memoryEnabled: boolean; notifySlack: boolean; slackMode: "thread" | "channel";
  allowSlackReplies: boolean; requiredMcp: string[]; sourceActions: unknown[];
  ignoreBotMessages: boolean;
}
interface RepositoryTarget { name: string; cwd: string; branch: string; target: string }
interface TaskContext {
  repository: RepositoryTarget | null;
  pullRequestNumber: number | null;
  target: string;
  channel: string | null;
  threadTs: string | null;
  prompt: string;
}
interface AutomationResult {
  summary: string;
  slackMessage: string | null;
  slackReplies: string[];
  memory: Record<string, string>;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function taskContext(ctx: TriggerContext): Promise<TaskContext> {
  const payload = record(ctx.event.payload);
  const event = record(payload["event"] ?? payload);
  const repoName = text(record(payload["repository"])["full_name"])
    ?? (ctx.event.source === "github" || ctx.event.source === "manual" ? text(ctx.event.resource) : null);
  const repository = repositories.find((item) => item.name === repoName)
    ?? (repositories.length === 1 && repoName === null ? repositories[0]! : null);
  if (integration.requiresRepository && repository === null) ctx.skip("Provide an event for one of the configured repositories.");
  let pullRequestNumber: number | null = null;
  let pullRequest: unknown = null;
  if (integration.eventKind === "pull_request" || integration.eventKind === "review_comment") {
    pullRequestNumber = positiveNumber(record(payload["pull_request"])["number"])
      ?? positiveNumber(payload["pullRequestNumber"]) ?? positiveNumber(payload["number"]);
    if (pullRequestNumber === null || repository === null) ctx.skip("Provide pull_request.number and the repository in the manual input.");
    pullRequest = await ctx.github.request("read-pull", "repository", {
      method: "GET", path: "/repos/" + repository.name + "/pulls/" + pullRequestNumber,
    });
    if (integration.ignoreDrafts && record(pullRequest)["draft"] === true) ctx.skip("Draft pull requests are excluded by this template.");
  }
  let workflow: unknown = payload["workflow_run"] ?? null;
  if (integration.eventKind === "workflow_failure") {
    if (workflow === null && ctx.event.source === "manual" && repository !== null) {
      const recent = await ctx.github.request<{ workflow_runs: unknown[] }>("find-failed-workflow", "repository", {
        method: "GET", path: "/repos/" + repository.name + "/actions/runs?per_page=10",
      });
      workflow = recent.workflow_runs.find((item) => integration.conclusions.includes(String(record(item)["conclusion"]))) ?? null;
    }
    if (!integration.conclusions.includes(String(record(workflow)["conclusion"]))) ctx.skip("Only failed or cancelled workflow runs are eligible.");
  }
  const channel = text(event["channel"]) ?? text(event["channelId"]);
  const threadTs = text(event["thread_ts"]) ?? text(event["threadTs"]) ?? text(event["ts"]);
  if (integration.eventKind === "slack_message") {
    if (channel !== slackDestination) ctx.skip("This message is outside the configured Slack channel.");
    if (integration.ignoreBotMessages && (event["bot_id"] || event["subtype"] === "bot_message")) ctx.skip("Ignore bot messages to avoid replying to this automation.");
    if (integration.slackMode === "thread" && threadTs === null) ctx.skip("Provide the triggering Slack message timestamp.");
  }
  const ci = integration.eventKind === "ci_failure" ? await ciContext(ctx) : null;
  const inputs = { ...extraInputs, repo: repository?.name ?? null, repos: repositories.map((item) => item.name), slack_channel: slackDestination };
  return {
    repository, pullRequestNumber, target: repository?.target ?? "workspace", channel, threadTs,
    prompt: [ci, "## Trigger context", JSON.stringify({ inputs, event: ctx.event, repository: repository?.name ?? null, branch: repository?.branch ?? null, pull_request: pullRequest, workflow_run: workflow, requiredMcp: integration.requiredMcp, originalToolConfiguration: integration.sourceActions }, null, 2)].filter(Boolean).join("\n\n"),
  };
}

async function deliverSlack(ctx: TriggerContext, context: TaskContext, result: AutomationResult) {
  const message = result.slackMessage?.trim();
  if (!integration.notifySlack) return false;
  if (result.slackReplies.length > 0 && (!integration.allowSlackReplies || !message))
    throw new Error("This result contains unsupported Slack followups or has no parent message.");
  if (!message) return false;
  if (result.slackReplies.length > 5) throw new Error("At most five Slack followups are allowed.");
  const thread = integration.slackMode === "thread" ? context.threadTs : null;
  const receipt = await slackPost(ctx, "post-slack", message, thread);
  for (let index = 0; index < result.slackReplies.length; index++) {
    await slackPost(ctx, "post-slack-reply:" + index, result.slackReplies[index]!, thread ?? receipt.ts);
  }
  return true;
}
async function slackPost(ctx: TriggerContext, id: string, message: string, thread: string | null) {
  return ctx.step(id, { channel: slackDestination, text: message, ...(thread === null ? {} : { thread_ts: thread }) }, async (input) => {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: "Bearer " + ctx.secret("SLACK_BOT_TOKEN"), "content-type": "application/json" },
      body: JSON.stringify(input), signal: AbortSignal.timeout(30_000),
    });
    const receipt = await response.json() as { ok?: boolean; ts?: string; channel?: string };
    if (!response.ok || !receipt.ok || !receipt.ts || !receipt.channel)
      throw new Error("Slack message delivery failed; memory was not updated.");
    return { channel: receipt.channel, ts: receipt.ts };
  });
}

const hubInstructions = [
  "## Miko Hub execution adapter",
  "The original prompt above defines the task. Use these explicit native tool adaptations:",
  "1. Cursor action links and built-in tool names describe capabilities. Use the equivalent tools configured on this daemon/provider. Required MCP servers and original tool flags are listed in Trigger context; do not assume Cursor-only tools are automatically installed. Preserve the task's read/write and approval limits.",
  integration.memoryEnabled
    ? "2. The JSON snapshot below is persistent memory: keys are filenames, values are complete file contents. Missing files are empty. Use local scratch files and Python where the original prompt requires it. Return the complete updated file map in memory; preserve unchanged files and omit deleted ones. Hub serializes runs and saves it only after required delivery."
    : "2. This template disables persistent memory. Return an empty memory object; no prior-run snapshot is provided or saved.",
  integration.notifySlack
    ? "3. Return the final Slack message in slackMessage (or null when the task says to stay silent). Do not send it yourself. Hub delivers it to the configured destination. Do not invent a sent-message URL; use an empty reported_link when none is available."
    : "3. This template has no Slack delivery action. Return slackMessage: null and slackReplies: []; put the requested final report in summary. GitHub replies, reviews and reviewer requests use the configured git/gh tools and granted permissions.",
  integration.allowSlackReplies
    ? "4. For a build-health failure, put the parent report in slackMessage and the read-only investigation reply in slackReplies. Hub uses the actual parent receipt to publish threaded replies. Return no replies on success."
    : "4. Return slackReplies: []; this workflow does not enable additional Slack followups.",
  integration.slackMode === "thread" ? "5. The final Slack message is delivered in the triggering thread. Use the Slack channel/thread_ts context to read that full thread with your configured Slack tools." : "5. Slack notifications, when enabled, go to the explicitly configured destination.",
  integration.requiresRepository
    ? "6. Use the repository and branch in Trigger context. git/gh use the declared Hub GitHub grant. PR events check out that PR; inline-comment fixes must push to its existing branch. Cursor-generated PR links are unavailable, so include the actual PR link in your output."
    : "6. This template has no repository, GitHub credential grant or git worktree. Use the configured MCP data sources from the automation workspace.",
  integration.eventKind === "ci_failure" ? "7. Hub has already claimed the sorted failing-job key for 30 minutes. Skip the original prompt's memory-based claim and perform its investigation and output steps." : "7. Use the provided event payload as the triggering context.",
  "Return a concise summary of the outcome in summary, including any unavailable required tools. Keep secrets out of output and memory.",
  "## Persistent memory snapshot",
].join("\n");

const resultSchema = {
  type: "object",
  properties: {
    summary: { type: "string" }, slackMessage: { type: ["string", "null"] },
    slackReplies: { type: "array", items: { type: "string" }, maxItems: 5 },
    memory: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["summary", "slackMessage", "slackReplies", "memory"], additionalProperties: false,
};
`;
