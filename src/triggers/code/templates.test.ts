/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- generated modules and operation inputs are checked through the public builder and SDK contracts */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { pipelineRunStates } from "./pipeline.js";
import upstreamCatalog from "./template-catalog.upstream.json" with { type: "json" };
import { buildTrigger } from "./build.js";
import { runTriggerCommand } from "./cli.js";
import {
  createTriggerContext,
  type TriggerDefinition,
  type TriggerEvent,
  type TriggerTransport,
  type TriggerAgentOptions,
} from "./sdk.js";
import {
  findTriggerTemplate,
  TRIGGER_TEMPLATES,
  triggerTemplateSource,
  triggerTemplateManifest,
} from "./templates.js";
import { templatePreview } from "./template-preview.js";

let directory: string;
const definitions = new Map<string, TriggerDefinition>();

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "miko-trigger-templates-"));
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    for (const template of TRIGGER_TEMPLATES) {
      const path = join(directory, template.id);
      await runTriggerCommand([
        "init",
        path,
        "--template",
        template.id,
        "--name",
        "custom-" + template.id,
      ]);
      const artifact = await buildTrigger(join(path, "trigger.ts"));
      assert.equal(artifact.manifest.name, "custom-" + template.id);
      assert.deepEqual(
        artifact.manifest,
        triggerTemplateManifest(template, "custom-" + template.id),
      );
      assert.deepEqual(artifact.manifest.template, { id: template.id, version: template.version });
      assert.ok(artifact.sources.some((file) => file.path === ".miko-template.json"));
      assert.equal(
        await readFile(join(path, "trigger.ts"), "utf8"),
        triggerTemplateSource(template, "custom-" + template.id),
      );
      assert.equal(artifact.manifest.on[0]?.source, "manual");
      assert.equal(artifact.manifest.on[1]?.source, template.trigger.source);
      assert.equal(
        artifact.manifest.grants.github?.["repository"]?.permissions["contents"],
        template.requiresRepository ? template.githubPermissions.contents : undefined,
      );
      const compiled = join(path, "built.mjs");
      await writeFile(compiled, artifact.code);
      const module = (await import(pathToFileURL(compiled).href)) as { default: TriggerDefinition };
      definitions.set(template.id, module.default);
    }
  } finally {
    output.mockRestore();
  }
}, 60_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const event: TriggerEvent = {
  id: "event",
  source: "manual",
  type: "run",
  receivedAt: "2026-11-15T10:00:00Z",
  payload: null,
};

function fixture(
  options: {
    event?: TriggerEvent;
    slackMessage?: string | null;
    slackOk?: boolean;
    slackReplies?: string[];
    draft?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const operations: { id: string; kind: string; status: string; executionId: null }[] = [];
  const prompts: TriggerAgentOptions[] = [];
  const state = new Map<string, unknown>([
    ["memory", { "MEMORIES.md": "Previously reported finding" }],
  ]);
  const memory = { "MEMORIES.md": "Updated findings" };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json(
        options.slackOk === false ? { ok: false } : { ok: true, ts: "123.456", channel: "channel" },
      ),
    );
  const transport: TriggerTransport = {
    async operation(request) {
      calls.push(request.kind);
      operations.push({
        id: request.id,
        kind: request.kind,
        status: "completed",
        executionId: null,
      });
      const input = request.input as Record<string, unknown>;
      if (request.kind === "state.get")
        return { status: "completed", output: state.get(String(input["key"])) ?? null };
      if (request.kind === "state.set") state.set(String(input["key"]), input["value"]);
      if (request.kind === "agent") {
        prompts.push(request.input as TriggerAgentOptions);
        return {
          status: "completed",
          output: {
            runId: "child",
            executionId: "execution",
            output: {
              summary: "Automation summary",
              slackMessage: options.slackMessage === undefined ? "Findings" : options.slackMessage,
              slackReplies: options.slackReplies ?? [],
              memory,
            },
          },
        };
      }
      if (request.kind === "github") {
        const path = String(input["path"]);
        let data: unknown = {
          workflow_runs: [
            {
              id: 1,
              head_branch: "main",
              conclusion: "failure",
              html_url: "https://github.com/owner/repo/actions/runs/1",
            },
          ],
        };
        if (path.includes("/pulls/"))
          data = {
            number: 1,
            draft: options.draft ?? false,
            state: "open",
            head: { ref: "feature" },
            base: { ref: "main" },
          };
        else if (path.includes("/jobs"))
          data = {
            jobs: [
              {
                name: "Tests",
                conclusion: "failure",
                html_url: "https://github.com/owner/repo/actions/runs/1",
              },
            ],
          };
        return {
          status: "completed",
          output: input["response"] === true ? { data, status: 200, headers: {} } : data,
        };
      }
      return request.kind === "step"
        ? { status: "execute" }
        : { status: "completed", output: null };
    },
    async complete(id, result) {
      calls.push(id + ("output" in result ? ":completed" : ":failed"));
    },
    async log() {},
  };
  const context = createTriggerContext({
    runId: "run",
    event: options.event ?? {
      ...event,
      payload: {
        repository: { full_name: "owner/repo" },
        pull_request: { number: 1 },
        event: {
          channel: "your-slack-channel-id",
          ts: "1700000000.000001",
          text: "Incoming message",
        },
      },
    },
    startedAt: event.receivedAt,
    deadlineAt: "2026-11-15T11:00:00Z",
    secrets: { SLACK_BOT_TOKEN: "private-token" },
    transport,
  }).context;
  return { context, calls, operations, prompts, state, memory, fetch };
}

describe("built-in Trigger templates", () => {
  it("previews each real template with its authored Pipeline and inspected agent call", () => {
    for (const template of TRIGGER_TEMPLATES) {
      const preview = templatePreview(template);
      const definition = definitions.get(template.id)!;
      assert.deepEqual(preview.manifest.pipeline, definition.pipeline, template.id);
      assert.deepEqual(preview.manifest.on, definition.on, template.id);
      assert.deepEqual(preview.manifest.grants, definition.grants, template.id);
      assert.equal(preview.inspection.agents.length, 1, template.id);
      assert.equal(preview.inspection.agents[0]?.provider.value, "codex", template.id);
    }
  });
  it("contains every upstream template and preserves every complete original prompt and workflow", () => {
    assert.equal(TRIGGER_TEMPLATES.length, 27);
    assert.deepEqual(
      TRIGGER_TEMPLATES.map((template) => template.id).sort(),
      upstreamCatalog.templates.map((template) => template.id).sort(),
    );
    for (const upstream of upstreamCatalog.templates) {
      const template = findTriggerTemplate(upstream.id)!;
      assert.equal(
        createHash("sha256").update(template.prompt).digest("hex"),
        upstream.promptSha256,
        upstream.id,
      );
      assert.deepEqual(template.upstreamWorkflow.triggers, upstream.triggers);
      assert.deepEqual(template.upstreamWorkflow.actions, upstream.actions);
      assert.deepEqual(
        template.inputs.map((input) => input.key),
        upstream.inputKeys,
      );
    }
  });
  it("passes every original prompt literally and persists memory only after Slack delivery", async () => {
    for (const template of TRIGGER_TEMPLATES) {
      const runtime = fixture();
      assert.deepEqual(await definitions.get(template.id)!.run(runtime.context), {
        notified: template.notifySlack,
        summary: "Automation summary",
      });
      assert.deepEqual(
        pipelineRunStates(definitions.get(template.id)!.pipeline, runtime.operations, "succeeded")
          .unmapped,
        [],
        template.id + " must map every durable operation to its Pipeline",
      );
      assert.ok(runtime.prompts[0]?.prompt.includes(template.prompt));
      assert.equal(
        runtime.prompts[0]?.prompt.includes("Previously reported finding"),
        template.requiresMemory,
      );
      assert.equal(
        runtime.prompts[0]?.github,
        template.requiresRepository ? "repository" : undefined,
      );
      if (template.requiresMemory) assert.deepEqual(runtime.state.get("memory"), runtime.memory);
      else assert.equal(runtime.calls.includes("state.set"), false);
      if (template.notifySlack) {
        if (template.requiresMemory)
          assert.ok(
            runtime.calls.indexOf("post-slack:completed") < runtime.calls.lastIndexOf("state.set"),
          );
        assert.ok(
          JSON.stringify(runtime.fetch.mock.calls.at(-1)?.[1]?.headers).includes("private-token"),
        );
      } else assert.equal(runtime.fetch.mock.calls.length, 0);
      assert.ok(!runtime.prompts[0]?.prompt.includes("private-token"));
      vi.restoreAllMocks();
    }
  });

  it("keeps quiet when there are no new findings, while saving the memory snapshot", async () => {
    const runtime = fixture({ slackMessage: null });
    assert.deepEqual(await definitions.get("scan-codebase-vulnerabilities")!.run(runtime.context), {
      notified: false,
      summary: "Automation summary",
    });
    assert.equal(runtime.fetch.mock.calls.length, 0);
    assert.deepEqual(runtime.state.get("memory"), runtime.memory);
  });

  it("does not grant a repository or create a worktree for any repository-free template", async () => {
    const items = TRIGGER_TEMPLATES.filter((template) => !template.requiresRepository);
    assert.equal(items.length, 5);
    for (const template of items) {
      const runtime = fixture();
      const definition = definitions.get(template.id)!;
      assert.equal(definition.grants.github, undefined);
      await definition.run(runtime.context);
      assert.equal(runtime.prompts[0]?.target, "workspace");
      assert.equal(runtime.prompts[0]?.worktree, undefined);
      vi.restoreAllMocks();
    }
  });

  it("rejects draft PRs before agent dispatch and binds the exact PR worktree for inline fixes", async () => {
    const draft = fixture({ draft: true });
    await assert.rejects(
      async () => definitions.get("assign-pr-reviewers")!.run(draft.context),
      /Draft pull requests/u,
    );
    assert.equal(draft.prompts.length, 0);
    vi.restoreAllMocks();
    const inline = fixture();
    await definitions.get("autofix-pr-review-comments")!.run(inline.context);
    assert.deepEqual(inline.prompts[0]?.worktree, { mode: "checkout-pr", prNumber: 1 });
    assert.equal(inline.fetch.mock.calls.length, 0);
  });

  it("replies to Slack bug reports in the triggering thread and requires its timestamp", async () => {
    const runtime = fixture();
    await definitions.get("fix-slack-bugs")!.run(runtime.context);
    const body = runtime.fetch.mock.calls[0]?.[1]?.body;
    assert.ok(typeof body === "string");
    assert.ok(body.includes('"thread_ts":"1700000000.000001"'));
    assert.equal(runtime.prompts.length, 1);
    vi.restoreAllMocks();
    const missing = fixture({
      event: {
        ...event,
        payload: { event: { channel: "your-slack-channel-id", text: "The button does nothing" } },
      },
    });
    await assert.rejects(
      async () => definitions.get("fix-slack-bugs")!.run(missing.context),
      /triggering Slack message timestamp/u,
    );
    assert.equal(missing.prompts.length, 0);
    assert.equal(missing.fetch.mock.calls.length, 0);
  });

  it("grants a Linear reply and declares Linear setup for issue triage", async () => {
    const template = findTriggerTemplate("linear-issue-triage")!;
    assert.deepEqual(template.requiredMcp, ["Linear"]);
    const source = triggerTemplateSource(template);
    assert.ok(source.includes("Required native MCP servers: Linear."));
    assert.ok(source.includes('outputs: { "linear.reply": { max: 1 } }'));
    const runtime = fixture();
    await definitions.get("linear-issue-triage")!.run(runtime.context);
    assert.deepEqual(runtime.prompts[0]?.outputs, { "linear.reply": { max: 1 } });
    const other = fixture();
    await definitions.get("remediate-dependency-vulnerabilities")!.run(other.context);
    assert.equal(other.prompts[0]?.outputs, undefined);
  });

  it("delivers FAQ answers in the triggering Slack thread and rejects other channels", async () => {
    const runtime = fixture();
    await definitions.get("product-faq-agent")!.run(runtime.context);
    const body = runtime.fetch.mock.calls[0]?.[1]?.body;
    assert.ok(typeof body === "string");
    assert.ok(body.includes('"thread_ts":"1700000000.000001"'));
    vi.restoreAllMocks();
    const unrelated = fixture({
      event: { ...event, payload: { event: { channel: "another-channel", ts: "123" } } },
    });
    await assert.rejects(
      async () => definitions.get("product-faq-agent")!.run(unrelated.context),
      /outside the configured Slack channel/u,
    );
    assert.equal(unrelated.prompts.length, 0);
  });

  it("uses the real parent receipt for build-health investigation replies before saving memory", async () => {
    const runtime = fixture({ slackReplies: ["Read-only investigation"] });
    const definition = definitions.get("build-healthcheck")!;
    await definition.run(runtime.context);
    assert.equal(runtime.fetch.mock.calls.length, 2);
    const body = runtime.fetch.mock.calls[1]?.[1]?.body;
    assert.ok(typeof body === "string");
    assert.ok(body.includes('"thread_ts":"123.456"'));
    assert.ok(
      runtime.calls.indexOf("post-slack-reply:0:completed") <
        runtime.calls.lastIndexOf("state.set"),
    );
    assert.deepEqual(
      pipelineRunStates(definition.pipeline, runtime.operations, "succeeded").unmapped,
      [],
    );
  });

  it("accepts cancelled workflow triage and preserves hourly and weekday schedules", async () => {
    const runtime = fixture({
      event: {
        ...event,
        source: "github",
        payload: {
          repository: { full_name: "owner/repo" },
          workflow_run: { id: 1, conclusion: "cancelled", head_branch: "feature" },
        },
      },
    });
    await definitions.get("triage-github-workflow-failures")!.run(runtime.context);
    assert.equal(runtime.prompts.length, 1);
    assert.equal(
      definitions.get("build-healthcheck")!.on[1]?.recurrence?.rule,
      "FREQ=HOURLY;BYMINUTE=0;BYSECOND=0",
    );
    assert.equal(
      definitions.get("sync-perf-test-feature-flags")!.on[1]?.recurrence?.rule,
      "FREQ=DAILY;BYHOUR=15;BYMINUTE=0;BYSECOND=0;BYDAY=MO,TU,WE,TH,FR",
    );
  });

  it("keeps Linear project resource IDs separate from the configured GitHub repository", async () => {
    const runtime = fixture({
      event: {
        ...event,
        source: "linear",
        type: "issue.create",
        resource: "linear-project-id",
        payload: { action: "create", issue: { title: "Dependency vulnerability" } },
      },
    });
    await definitions.get("remediate-dependency-vulnerabilities")!.run(runtime.context);
    assert.equal(runtime.prompts.length, 1);
    assert.ok(runtime.prompts[0]?.prompt.includes('"repository": "owner/repo"'));
  });

  it("fails a rejected Slack delivery without marking findings as reported", async () => {
    const runtime = fixture({ slackOk: false });
    await assert.rejects(
      async () => definitions.get("find-bugs")!.run(runtime.context),
      /Slack message delivery failed/u,
    );
    assert.deepEqual(runtime.state.get("memory"), { "MEMORIES.md": "Previously reported finding" });
  });

  it("ignores successful CI and failures on other branches before calling an agent", async () => {
    for (const workflow of [
      { id: 1, head_branch: "main", conclusion: "success" },
      { id: 2, head_branch: "feature", conclusion: "failure" },
    ]) {
      const runtime = fixture({
        event: {
          ...event,
          source: "github",
          type: "workflow_run.completed",
          payload: { workflow_run: workflow },
        },
      });
      await assert.rejects(
        async () => definitions.get("ci-autofix")!.run(runtime.context),
        /No failed CI run/u,
      );
      assert.equal(runtime.prompts.length, 0);
      assert.equal(runtime.fetch.mock.calls.length, 0);
      vi.restoreAllMocks();
    }
  });

  it("claims matching failing jobs once per 30 minutes and supplies the CI report", async () => {
    const runtime = fixture();
    const definition = definitions.get("ci-autofix")!;
    await definition.run(runtime.context);
    assert.ok(runtime.prompts[0]?.prompt.includes("CI Status Report"));
    assert.ok(runtime.prompts[0]?.prompt.includes('"name": "Tests"'));
    assert.equal(runtime.state.get("ci-fail-Tests"), event.receivedAt);
    await assert.rejects(async () => definition.run(runtime.context), /last 30 minutes/u);
    assert.equal(runtime.prompts.length, 1);
  });

  it("lists templates locally and rejects an unknown template before creating a project", async () => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runTriggerCommand(["templates"]);
    assert.ok(String(output.mock.calls[0]?.[0]).includes('"id": "find-bugs"'));
    await assert.rejects(
      runTriggerCommand(["init", join(directory, "unknown"), "--template", "missing"]),
      /Unknown template/u,
    );
    await assert.rejects(readFile(join(directory, "unknown", "trigger.ts")), /ENOENT/u);
    await assert.rejects(
      runTriggerCommand(["init", join(directory, "find-bugs"), "--template", "find-bugs"]),
      /EEXIST/u,
    );
    assert.equal(findTriggerTemplate("missing"), undefined);
  });
});
