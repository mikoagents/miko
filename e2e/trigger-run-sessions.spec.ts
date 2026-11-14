import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";
import { artifactDigest } from "../src/triggers/code/contract.js";

const SCREENSHOTS = "e2e/screenshots/trigger-run-sessions";

test("shows which agent calls of a Trigger run continued one session", async ({ hub, page }) => {
  await hub.signUpAs("owner", {
    name: "Session Owner",
    email: "session-owner@example.com",
    password: "zrbfvoqe-mtkxa-jqcw-plokreuy",
  });
  await hub.createOrganization("owner", "Session rounds");
  const daemonId = await hub.seedDaemonSlug("owner", "studio");
  const deployed = await hub.deployCodeTrigger("owner", reviewRounds());
  await seedRuns(hub.primaryApplication(), deployed, daemonId);

  const triggers = new OrganizationTriggers(page);
  await triggers.open();
  await page.getByRole("link", { name: "review-rounds", exact: true }).click();
  const configuration = page.locator('[data-summary="revise agent configuration"]');
  await expect(configuration).toContainText("Continuation key");
  await expect(configuration).toContainText("review");
  await expect(page.locator('[data-summary="check agent configuration"]')).not.toContainText(
    "Continuation key",
  );

  const history = page.getByRole("table", { name: "Run history" });
  await expect(history.getByRole("row").filter({ hasText: "Succeeded" })).toHaveCount(2);
  await history
    .getByRole("button", { name: /^Open run from / })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Activity details" });
  await expect(dialog.getByRole("radio", { name: "Run details", exact: true })).toBeChecked();
  const facts = dialog.locator('[data-summary="Trigger run"]');
  await expect(facts).toContainText("Succeeded");
  await expect(facts).toContainText("in 8m");
  await expect(facts).toContainText("On demand");
  await expect(facts).toContainText("studio");

  const sessions = dialog.getByRole("table", { name: "Agent sessions" });
  await expect(dialog.getByText("4 agent calls in 3 sessions.", { exact: false })).toBeVisible();
  const resumed = sessions.getByRole("row").filter({ hasText: /Session 1 ·/ });
  await expect(resumed).toContainText("Continued from an earlier run");
  await expect(resumed).toContainText("plan → revise");
  await expect(resumed).toContainText("review");
  const fresh = sessions.getByRole("row").filter({ hasText: /Session 2 ·/ });
  await expect(fresh).toContainText("Started in this run");
  await expect(fresh).toContainText("check");
  const renewed = sessions.getByRole("row").filter({ hasText: /Session 3 ·/ });
  await expect(renewed).toContainText("Replaced session 1");
  await expect(renewed).toContainText("reply");
  await expect(renewed).toContainText("review");

  const steps = dialog.getByRole("table", { name: "Steps" });
  await expect(steps.getByRole("row")).toHaveCount(7);
  await expect(steps.getByRole("row").filter({ hasText: "reply" })).toContainText("Session 3");
  await expect(steps.getByRole("row").filter({ hasText: "revise" })).toContainText("Session 1");
  await expect(steps.getByRole("row").filter({ hasText: "comment" })).toContainText(
    "POST /repos/acme/app/issues/12/comments",
  );
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/details-desktop.png` });
  await steps.scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/steps-desktop.png` });

  await sessions.getByRole("button", { name: "check", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Conversation", exact: true })).toBeChecked();
  const picker = dialog.getByRole("combobox", { name: "Agent session" });
  await expect(picker).toContainText("Session 2 · check");
  const transcript = dialog.getByRole("list", { name: "Session messages" });
  await expect(transcript.getByRole("listitem").first()).toContainText("check");
  await expect(transcript).toContainText("All 42 tests pass.");

  await picker.click();
  await page.getByRole("option", { name: /Session 1 · plan → revise/ }).click();
  await expect(dialog.getByText("Continued from an earlier run", { exact: true })).toBeVisible();
  const message = (text: string) => transcript.getByRole("listitem").filter({ hasText: text });
  await expect(message("Plan the review of the previous change.")).toContainText("User");
  await expect(message("Plan the review of pull request 12.")).toContainText("plan");
  await expect(message("Revise the review with the test results.")).toContainText("revise");
  await page.screenshot({
    animations: "disabled",
    path: `${SCREENSHOTS}/conversation-desktop.png`,
  });
  await message("Revise the review with the test results.").scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/rounds-desktop.png` });

  await picker.click();
  await page.getByRole("option", { name: /Session 3 · reply/ }).click();
  const startedOver = dialog.getByRole("status").filter({ hasText: "Started over" });
  await expect(startedOver).toContainText("Session 1 had this continuation key");
  await expect(message("Reply to the author with the review.")).toContainText("reply");
  await expect(transcript).not.toContainText("Plan the review of pull request 12.");
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/renewed-desktop.png` });

  await dialog.getByRole("radio", { name: "Run details", exact: true }).click();
  await steps.getByRole("button", { name: "comment", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Diagnostics", exact: true })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Step" })).toContainText("comment");
  await expect(dialog.getByRole("textbox", { name: "comment data", exact: true })).toContainText(
    "/repos/acme/app/issues/12/comments",
  );
  await dialog.getByRole("combobox", { name: "Step" }).click();
  await page.getByRole("option", { name: /^revise/ }).click();
  await expect(dialog.getByRole("textbox", { name: "revise data", exact: true })).toContainText(
    '"key": "review"',
  );
  await expect(dialog.getByRole("heading", { name: "Session details", exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/diagnostics-desktop.png` });

  await dialog.getByRole("radio", { name: "Run details", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sessions.getByRole("row").filter({ hasText: /Session 1 ·/ })).toBeVisible();
  await expect(dialog.locator('[data-slot="detail-dialog-body"]')).toHaveJSProperty(
    "scrollWidth",
    await dialog.locator('[data-slot="detail-dialog-body"]').evaluate((body) => body.clientWidth),
  );
  await page.screenshot({ animations: "disabled", path: `${SCREENSHOTS}/details-mobile.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await sessions.getByRole("button", { name: "plan → revise", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Conversation", exact: true })).toBeChecked();
  await expect(transcript).toContainText("Revise the review with the test results.");
  await page.screenshot({
    animations: "disabled",
    path: `${SCREENSHOTS}/conversation-mobile-dark.png`,
  });
});

interface Database {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

/**
 * A finished run whose calls share a key with an earlier run's, until the session finished holding
 * credentials and the last call with that key had to start over.
 */
async function seedRuns(
  database: Database,
  trigger: { triggerId: string; revisionId: string },
  daemonId: string,
) {
  const [scope] = await database.query(
    "select organization_id, runtime_project_id from organization_triggers where id = $1",
    [trigger.triggerId],
  );
  const organizationId = String(scope?.["organization_id"]);
  const projectId = String(scope?.["runtime_project_id"]);
  const [configuration] = await database.query(
    `insert into project_configuration_revisions
       (project_id, organization_id, version, source_kind, source_evidence,
        normalized_configuration, content_hash, validated_at)
     select $1, $2, coalesce(max(version), 0) + 1, 'manual', '{}'::jsonb,
            '{"environments":[],"triggers":[]}'::jsonb, 'session-rounds', now()
     from project_configuration_revisions where project_id = $1
     returning id`,
    [projectId, organizationId],
  );
  const context = {
    database,
    organizationId,
    projectId,
    configurationRevisionId: String(configuration?.["id"]),
    daemonId,
    trigger,
  };
  const review = await seedSession(
    context,
    "review",
    [
      ["earlier-plan", 1450, "Plan the review of the previous change."],
      ["", 1449, "The previous change only touched documentation."],
      ["plan", 9, "Plan the review of pull request 12."],
      ["", 8, "I'll read the diff first, then check the tests."],
      ["revise", 4, "Revise the review with the test results."],
      ["", 3, "Updated the review: the tests cover the new branch."],
    ],
    "released",
  );
  const tests = await seedSession(context, null, [
    ["check", 6, "Check the tests."],
    ["", 5, "All 42 tests pass."],
  ]);
  const reply = await seedSession(context, "review", [
    ["reply", 3, "Reply to the author with the review."],
    ["", 2, "Posted the review for the author."],
  ]);
  await run(context, 1452, 1440, [
    agentCall("plan", 1450, 1446, "Plan the review of the previous change.", review, "created"),
  ]);
  await run(context, 10, 2, [
    { id: "load", kind: "step", input: { pullRequest: 12 }, output: { files: 3 } },
    agentCall("plan", 9, 7, "Plan the review of pull request 12.", review, "restored"),
    agentCall("check", 6, 5, "Check the tests.", tests, "created"),
    agentCall("revise", 4, 3, "Revise the review with the test results.", review, "continued"),
    agentCall("reply", 3, 2, "Reply to the author with the review.", reply, "created"),
    {
      id: "comment",
      kind: "github",
      input: { method: "POST", path: "/repos/acme/app/issues/12/comments" },
      output: { id: 9001 },
    },
  ]);
}

interface Context {
  database: Database;
  organizationId: string;
  projectId: string;
  configurationRevisionId: string;
  daemonId: string;
  trigger: { triggerId: string; revisionId: string };
}

interface Step {
  id: string;
  kind: string;
  input: unknown;
  output: unknown;
  agent?: {
    started: number;
    finished: number;
    prompt: string;
    session: { id: string; executions: Map<string, string> };
    action: string;
  };
}

function agentCall(
  id: string,
  started: number,
  finished: number,
  prompt: string,
  session: { id: string; executions: Map<string, string>; key: string | null },
  action: string,
): Step {
  return {
    id,
    kind: "agent",
    input: {
      target: "repository",
      agent: { provider: "codex", model: "gpt-5.1" },
      prompt,
      maxRuntime: "10m",
      idleTimeout: "5m",
      ...(session.key === null ? {} : { continuation: { key: session.key } }),
    },
    output: { runId: randomUUID(), executionId: session.executions.get(prompt), output: null },
    agent: { started, finished, prompt, session, action },
  };
}

/**
 * A session and its synchronized history; each prompt is keyed by the execution that sent it. A
 * session Hub replaced gave its key up to the new one, so only its calls still name the key.
 */
async function seedSession(
  context: Context,
  key: string | null,
  messages: readonly (readonly [string, number, string])[],
  holds: "holds" | "released" = "holds",
) {
  const id = randomUUID();
  const executions = new Map<string, string>();
  const held = holds === "holds" ? key : null;
  await context.database.query(
    `insert into agent_sessions (id, organization_id, project_id, continuation_key, data)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      id,
      context.organizationId,
      context.projectId,
      held,
      JSON.stringify({
        id,
        organizationId: context.organizationId,
        projectId: context.projectId,
        continuationKey: held,
        daemonId: context.daemonId,
        agentId: `agent-${id}`,
        workspaceId: `workspace-${id}`,
        runtimeBinding: { provider: "codex", nativeAgentId: `native-${id}` },
      }),
    ],
  );
  await context.database.query(
    "insert into agent_session_timelines (session_id, data) values ($1, $2::jsonb)",
    [
      id,
      JSON.stringify({
        epoch: "session-rounds",
        startSeq: 1,
        endSeq: messages.length,
        hasOlder: false,
        hasNewer: false,
        updatedAt: minutesAgo(2),
        agent: {
          nativeAgentId: `native-${id}`,
          provider: "codex",
          providerSessionId: `thread-${id}`,
          status: "idle",
          cwd: "/workspace/app",
          model: "gpt-5.1",
        },
      }),
    ],
  );
  for (const [index, [sender, ago, text]] of messages.entries()) {
    const executionId = sender === "" ? undefined : randomUUID();
    if (executionId !== undefined) executions.set(text, executionId);
    const item =
      executionId === undefined
        ? { type: "assistant_message", text }
        : { type: "user_message", text, messageId: executionId };
    await context.database.query(
      "insert into agent_session_timeline_rows (session_id, seq, data) values ($1, $2, $3::jsonb)",
      [id, index + 1, JSON.stringify({ seq: index + 1, timestamp: minutesAgo(ago), item })],
    );
  }
  return { id, executions, key };
}

async function run(context: Context, started: number, finished: number, steps: readonly Step[]) {
  const runId = randomUUID();
  const event = {
    id: `rounds-${runId}`,
    source: "manual",
    type: "run",
    receivedAt: minutesAgo(started),
    payload: null,
  };
  await context.database.query(
    `insert into trigger_code_runs (id, organization_id, trigger_id, revision_id, status, created_at, document)
     values ($1, $2, $3, $4, 'succeeded', $5, $6::jsonb)`,
    [
      runId,
      context.organizationId,
      context.trigger.triggerId,
      context.trigger.revisionId,
      minutesAgo(started),
      JSON.stringify({
        id: runId,
        organizationId: context.organizationId,
        triggerId: context.trigger.triggerId,
        revisionId: context.trigger.revisionId,
        runner: "browser",
        event,
        status: "succeeded",
        output: { reviewed: true },
        error: null,
        createdAt: minutesAgo(started),
        deadlineAt: minutesAgo(started - 60),
        completedAt: minutesAgo(finished),
        leaseHash: null,
        leaseExpiresAt: null,
        leaseRunnerId: null,
        wakeAt: null,
        waitingFor: [],
        cleanupPending: false,
      }),
    ],
  );
  for (const [index, step] of steps.entries()) {
    const createdAt = new Date(Date.parse(minutesAgo(started)) + index * 1000).toISOString();
    const childRunId = step.agent === undefined ? null : await child(context, runId, step);
    await context.database.query(
      `insert into trigger_code_operations (organization_id, run_id, operation_id, created_at, document)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        context.organizationId,
        runId,
        step.id,
        createdAt,
        JSON.stringify({
          runId,
          id: step.id,
          kind: step.kind,
          input: step.input,
          inputHash: `hash-${step.id}`,
          status: "completed",
          output: step.output,
          error: null,
          wakeAt: null,
          childRunId,
          leaseHash: "",
          createdAt,
        }),
      ],
    );
  }
}

/** The workflow run an agent call starts, with its one step and the execution that ran it. */
async function child(context: Context, parentRunId: string, step: Step): Promise<string> {
  const agent = step.agent!;
  const prompt = agent.prompt;
  const executionId = agent.session.executions.get(prompt) ?? randomUUID();
  const [receipt] = await context.database.query(
    `insert into provider_event_receipts (organization_id, provider, delivery_id, source, payload, received_at)
     values ($1, 'manual', $2, 'manual.run', '{}'::jsonb, $3) returning id`,
    [context.organizationId, `trigger-code-agent:${randomUUID()}`, minutesAgo(agent.started)],
  );
  const [created] = await context.database.query(
    `insert into trigger_runs
       (organization_id, project_id, configuration_revision_id, provider_event_receipt_id,
        configured_trigger_name, status, prompt, trigger_context, deadline_at, created_at,
        completed_at)
     values ($1, $2, $3, $4, 'review-rounds', 'succeeded', $5, $6::jsonb, $7, $8, $9)
     returning id`,
    [
      context.organizationId,
      context.projectId,
      context.configurationRevisionId,
      receipt?.["id"],
      prompt,
      JSON.stringify({ provider: "trigger_code", parentRunId }),
      minutesAgo(agent.started - 60),
      minutesAgo(agent.started),
      minutesAgo(agent.finished),
    ],
  );
  const runId = String(created?.["id"]);
  const [workflowStep] = await context.database.query(
    `insert into workflow_step_runs (trigger_run_id, step_id, ordinal, status, started_at, completed_at)
     values ($1, 'run', 0, 'succeeded', $2, $3) returning id`,
    [runId, minutesAgo(agent.started), minutesAgo(agent.finished)],
  );
  await context.database.query(
    `insert into agent_executions
       (id, organization_id, project_id, configuration_revision_id, status, workflow_step_run_id,
        daemon_id, agent_session_id, agent_session_action, started_at, completed_at)
     values ($1, $2, $3, $4, 'succeeded', $5, $6, $7, $8, $9, $10)`,
    [
      executionId,
      context.organizationId,
      context.projectId,
      context.configurationRevisionId,
      workflowStep?.["id"],
      context.daemonId,
      agent.session.id,
      agent.action,
      minutesAgo(agent.started),
      minutesAgo(agent.finished),
    ],
  );
  await context.database.query(
    "update workflow_step_runs set agent_execution_id = $2 where id = $1",
    [workflowStep?.["id"], executionId],
  );
  return runId;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function reviewRounds() {
  const options = (prompt: string, key?: string) =>
    JSON.stringify({
      target: "repository",
      agent: { provider: "codex", model: "gpt-5.1" },
      prompt,
      ...(key === undefined ? {} : { continuation: { key } }),
    });
  const code = [
    "export default {",
    "  async run(ctx) {",
    '    await ctx.step("load", { pullRequest: 12 }, async () => ({ files: 3 }));',
    `    await ctx.agent.run("plan", ${options("Plan the review of pull request 12.", "review")});`,
    `    await ctx.agent.run("check", ${options("Check the tests.")});`,
    `    await ctx.agent.run("revise", ${options("Revise the review with the test results.", "review")});`,
    `    await ctx.agent.run("reply", ${options("Reply to the author with the review.", "review")});`,
    "    return { reviewed: true };",
    "  },",
    "};",
  ].join("\n");
  const body = {
    format: "trigger-code-v1" as const,
    manifest: {
      name: "review-rounds",
      runner: "browser",
      description: "Reviews a pull request over several agent rounds",
      on: [{ source: "manual", event: "run" }],
      grants: {
        targets: { repository: { daemon: "studio", cwd: "/workspace/app", providers: ["codex"] } },
      },
      limits: { maxRuntime: "1h" },
    },
    code,
    entrypoint: "trigger.ts",
    sources: [{ path: "trigger.ts", content: code }],
  };
  return { ...body, digest: artifactDigest(body) };
}
