import assert from "node:assert/strict";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { artifactDigest, type TriggerArtifact } from "./contract.js";
import { TriggerCodeService } from "./service.js";
import { OrganizationTriggerStore } from "../store.js";
import { TriggerDashboard } from "../dashboard.js";
import type { AuthServer } from "../../auth/server.js";
import { acceptingAgentValidator } from "../../test-utils/agent-validator.js";
import { setupCodeStorage } from "./test-fixture.js";
import { agentSessions } from "./run-presentation.js";

let postgres: StartedPostgreSqlContainer;
beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
}, 120_000);
afterAll(async () => {
  await postgres?.stop();
}, 120_000);

describe.each(["embedded", "postgres"] as const)("programmable Trigger on %s", (kind) => {
  it("recovers a real database and worker without redispatching an acknowledged agent; validates completion through MCP", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      const deployed = await fixture.service().deploy("code-org", program());
      const started = await fixture.service().receive("code-org", deployed.triggerId, {
        id: "original",
        source: "manual",
        type: "run",
        receivedAt: new Date().toISOString(),
        payload: { ignored: "must not enter the prompt" },
      });
      assert.ok(started.run);
      assert.deepEqual(
        await fixture.database().listTriggerRunDaemons("code-org", [started.run.id]),
        [],
      );
      await fixture.execute();
      await expect.poll(() => fixture.daemon.prompts.length).toBe(1);
      const daemon = (await fixture.database().listDaemonsForOrganization("code-org"))[0]!;
      const expectedDaemon = { runId: started.run.id, daemonId: daemon.id, slug: "devbox" };
      assert.deepEqual(
        await fixture.database().listTriggerRunDaemons("code-org", [started.run.id]),
        [expectedDaemon],
      );
      assert.equal(fixture.daemon.prompts[0], literalPrompt);
      // An invalid finish does not complete the child or its parent.
      const invalid = await fixture.finish(0, {});
      assert.equal(invalid.isError, true);
      assert.equal((await fixture.read(started.run.id)).status, "waiting");
      const firstReceipt = await fixture.finish(0, { output: { value: "first" } });
      assert.equal(firstReceipt.isError, undefined, JSON.stringify(firstReceipt));
      await fixture.restart();
      await fixture.execute();
      await expect.poll(() => fixture.daemon.prompts.length).toBe(2);
      assert.equal((await fixture.finish(1, { output: { value: "second" } })).isError, undefined);
      await fixture.execute();
      const finished = await fixture.read(started.run.id);
      assert.equal(finished.status, "succeeded");
      assert.deepEqual(finished.output, { first: { value: "first" }, second: { value: "second" } });
      assert.equal(fixture.daemon.launches.length, 2);
      const duplicate = await fixture
        .service()
        .receive("code-org", deployed.triggerId, started.run.event);
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.run?.id, started.run.id);
      const count = await fixture
        .bundle()
        .runtime.query<{ count: number }>(
          "select count(*)::int as count from trigger_code_operations",
        );
      assert.equal(count.rows[0]?.count, 2);
      // Two operations on one daemon appear once; child workflow runs retain their own attribution.
      assert.deepEqual(
        await fixture.database().listTriggerRunDaemons("code-org", [started.run.id]),
        [expectedDaemon],
      );
      const child = await fixture
        .database()
        .triggerCode.transaction(
          "code-org",
          async (tx) => (await tx.operations(started.run!.id))[0]!.childRunId,
        );
      assert.ok(child);
      assert.deepEqual(await fixture.database().listTriggerRunDaemons("code-org", [child]), [
        { ...expectedDaemon, runId: child },
      ]);
      assert.deepEqual(
        await fixture.database().listTriggerRunDaemons("other-org", [started.run.id, child]),
        [],
      );
      assert.deepEqual(await fixture.database().listTriggerRunDaemons("code-org", []), []);
      await fixture.database().revokeDaemon(daemon.id);
      assert.deepEqual(
        await fixture.database().listTriggerRunDaemons("code-org", [started.run.id]),
        [expectedDaemon],
      );
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("keeps an unstarted agent waiting while its daemon is disconnected and dispatches it once after reconnection", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      const deployed = await fixture.service().deploy("code-org", program());
      fixture.setConnected(false);
      const started = await fixture.service().receive("code-org", deployed.triggerId, {
        id: "offline",
        source: "manual",
        type: "run",
        receivedAt: new Date().toISOString(),
        payload: null,
      });
      assert.ok(started.run);
      await fixture.execute();
      await fixture.service().tick();
      assert.equal(fixture.daemon.launches.length, 0);
      assert.equal((await fixture.read(started.run.id)).status, "waiting");
      fixture.setConnected(true);
      await fixture.service().tick();
      await expect.poll(() => fixture.daemon.prompts.length).toBe(1);
      assert.equal((await fixture.finish(0, { output: { value: "first" } })).isError, undefined);
      await fixture.execute();
      await expect.poll(() => fixture.daemon.prompts.length).toBe(2);
      assert.equal((await fixture.finish(1, { output: { value: "second" } })).isError, undefined);
      await fixture.execute();
      assert.equal((await fixture.read(started.run.id)).status, "succeeded");
      assert.equal(fixture.daemon.launches.length, 2);
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("keeps a removed native subscription for an accepted run and releases it when that run completes", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri(), true);
    try {
      const code =
        "export default {async run(ctx){if(ctx.event.source!=='manual')return null; const event=await ctx.waitForEvent('ci',{source:'github',event:'workflow_run.completed',timeout:'1m'});return event.payload;}};";
      const body = {
        format: "trigger-code-v1" as const,
        manifest: {
          name: "native-wait",
          runner: "test",
          on: [
            { source: "manual", event: "run" },
            {
              source: "github",
              event: "workflow_run.completed",
              connection: "github",
              resource: "example/project",
            },
          ],
          grants: {},
          limits: { maxRuntime: "1h" },
        },
        code,
        sources: [{ path: "trigger.js", content: code }],
      };
      const deployed = await fixture
        .service()
        .deploy("code-org", { ...body, digest: artifactDigest(body) });
      const started = await fixture.service().receive("code-org", deployed.triggerId, {
        id: "begin-wait",
        source: "manual",
        type: "run",
        receivedAt: new Date().toISOString(),
        payload: null,
      });
      assert.ok(started.run);
      await fixture.execute();
      assert.equal((await fixture.read(started.run.id)).status, "waiting");
      body.manifest.on = [{ source: "manual", event: "run" }];
      await fixture.service().deploy("code-org", { ...body, digest: artifactDigest(body) });
      await fixture.service().setEnabled("code-org", deployed.triggerId, false);
      const input = {
        installationId: 42,
        repositoryId: 9001,
        repo: "example/project",
        source: "github.workflow_run",
        deliveryId: "after-redeploy",
        receivedAt: new Date(),
        payload: { repo: "example/project", payload: { action: "completed", evidence: "settled" } },
      };
      const accepted = await fixture.database().acceptGitHubEvent(input);
      assert.equal(accepted.status, "accepted");
      if (accepted.status !== "accepted") throw new Error("Missing old revision subscription");
      for (const event of accepted.events) await fixture.service().acceptProviderEvent(event);
      await fixture.execute();
      const recovered = await fixture.read(started.run.id);
      assert.equal(recovered.status, "succeeded");
      assert.deepEqual(recovered.output, { action: "completed", evidence: "settled" });
      const runs = await fixture
        .database()
        .triggerCode.transaction("code-org", (tx) => tx.listRuns(deployed.triggerId));
      assert.equal(runs.length, 1);
      const released = await fixture
        .database()
        .acceptGitHubEvent({ ...input, deliveryId: "after-finish", receivedAt: new Date() });
      assert.equal(released.status, "dropped");
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("rewrites a historical YAML Trigger under the same identity and retains its revision and disabled state", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      const database = fixture.database();
      const historical = await new OrganizationTriggerStore(
        database,
        "code-org",
        acceptingAgentValidator(),
      ).save({
        yaml: "name: code-review\nenabled: false\non:\n  manual.run: {}\nrun:\n  target: {daemon: devbox, cwd: /workspace/test}\n  agent: {provider: codex, mode: full-access}\n  prompt: Historical prompt\n",
        userId: null,
      });
      await fixture
        .bundle()
        .runtime.query("update organization_triggers set runtime_project_id=null where id=$1", [
          historical.id,
        ]);
      const deployed = await fixture.service().deploy("code-org", program());
      assert.equal(deployed.triggerId, historical.id);
      assert.equal(deployed.version, 2);
      const current = await fixture.service().trigger("code-org", historical.id);
      assert.equal(current.enabled, false);
      assert.equal(typeof current.runtimeProjectId, "string");
      assert.ok(current.runtimeProjectId);
      const old = await database.findOrganizationTriggerRevision(
        historical.id,
        historical.activeRevisionId,
      );
      assert.match(old!.yaml, /Historical prompt/u);
      assert.equal(old!.version, 1);
      await assert.rejects(
        fixture.service().receive("code-org", historical.id, {
          id: "disabled",
          source: "manual",
          type: "run",
          receivedAt: new Date().toISOString(),
          payload: null,
        }),
        /disabled/u,
      );
      await fixture.service().setEnabled("code-org", historical.id, true);
      assert.equal((await fixture.service().trigger("code-org", historical.id)).enabled, true);
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("rolls back a scheduled occurrence with its cursor, recovers it after restart, and persists finite exhaustion", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      await fixture.service().stop();
      const database = fixture.database();
      const artifact = program();
      artifact.manifest.name = "finite-schedule";
      artifact.manifest.grants = {};
      artifact.manifest.on = [
        {
          source: "schedule",
          event: "tick",
          recurrence: { start: "2098-01-01T09:00:00", timezone: "UTC", rule: "FREQ=DAILY;COUNT=1" },
        },
      ];
      const { digest: _digest, ...body } = artifact;
      artifact.digest = artifactDigest(body);
      const deployed = await fixture.service().deploy("code-org", artifact);
      const service = new TriggerCodeService(
        database,
        { ensure: async () => {}, cancel: async () => {}, github: async () => null },
        () => new Date("2099-01-01"),
      );
      const repository = database.triggerCode;
      const crash = interruptScheduledCommit(repository);
      await assert.rejects(service.tick(), /simulated interruption/u);
      crash.mockRestore();
      assert.deepEqual(
        await repository.transaction("code-org", (tx) => tx.listRuns(deployed.triggerId)),
        [],
      );
      assert.equal(
        await repository.transaction("code-org", (tx) =>
          tx.getState(deployed.triggerId, "state", "__schedule"),
        ),
        undefined,
      );
      await service.tick();
      const [run] = await repository.transaction("code-org", (tx) =>
        tx.listRuns(deployed.triggerId),
      );
      assert.equal(run!.event.id, "schedule:2098-01-01T09:00:00.000Z");
      await fixture.restart();
      await fixture.service().stop();
      const recovered = new TriggerCodeService(
        fixture.database(),
        { ensure: async () => {}, cancel: async () => {}, github: async () => null },
        () => new Date("2099-01-01"),
      );
      await recovered.tick();
      const runs = await fixture
        .database()
        .triggerCode.transaction("code-org", (tx) => tx.listRuns(deployed.triggerId));
      assert.equal(runs.length, 1);
      assert.equal(runs[0]!.id, run!.id);
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("shows which agent calls continued one session in the run detail", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      const sql = fixture.bundle().runtime;
      await sql.query(`insert into "user" (id, name, email, email_verified)
        values ('code-user', 'Code user', 'code-user@miko.test', true)`);
      await sql.query(`insert into member (id, organization_id, user_id, role)
        values ('code-member', 'code-org', 'code-user', 'owner')`);
      const deployed = await fixture.service().deploy("code-org", sessionProgram());
      const started = await fixture.service().receive("code-org", deployed.triggerId, {
        id: "rounds",
        source: "manual",
        type: "run",
        receivedAt: new Date().toISOString(),
        payload: null,
      });
      assert.ok(started.run);
      // plan and revise share a continuation key; check, between them, has none.
      for (const [round, launch] of [0, 1, 0].entries()) {
        await fixture.execute();
        await expect.poll(() => fixture.daemon.prompts.length).toBe(round + 1);
        const receipt = await fixture.finish(launch, { output: { value: String(round) } });
        assert.equal(receipt.isError, undefined, JSON.stringify(receipt));
      }
      await fixture.execute();
      assert.equal((await fixture.read(started.run.id)).status, "succeeded");
      assert.equal(fixture.daemon.launches.length, 2);

      const dashboard = new TriggerDashboard(
        fixture.database(),
        memberAuth(),
        acceptingAgentValidator(),
      );
      const detail = await dashboard.codeRunDetail(new Request("https://hub.test/o/code-tests"), {
        organizationSlug: "code-tests",
        triggerId: deployed.triggerId,
        runId: started.run.id,
      });
      assert.equal(detail.run.version, 1);
      const [plan, check, revise] = detail.operations.map((operation) => operation.agent);
      assert.ok(plan?.sessionId && check?.sessionId && revise?.sessionId);
      assert.equal(revise.sessionId, plan.sessionId);
      assert.notEqual(check.sessionId, plan.sessionId);
      assert.deepEqual(
        [plan, check, revise].map((agent) => ({
          provider: agent.provider,
          prompt: agent.prompt,
          continuationKey: agent.continuationKey,
          sessionAction: agent.sessionAction,
          finished: agent.startedAt !== null && agent.completedAt !== null,
        })),
        [
          {
            provider: "codex",
            prompt: "Plan the review.",
            continuationKey: "review",
            sessionAction: "created",
            finished: true,
          },
          {
            provider: "codex",
            prompt: "Check the tests.",
            continuationKey: null,
            sessionAction: "created",
            finished: true,
          },
          {
            provider: "codex",
            prompt: "Revise the review.",
            continuationKey: "review",
            sessionAction: "continued",
            finished: true,
          },
        ],
      );
      const { calls, sessions } = agentSessions(detail.operations);
      assert.deepEqual(
        calls.map((call) => [call.id, call.session]),
        [
          ["plan", 1],
          ["check", 2],
          ["revise", 1],
        ],
      );
      assert.deepEqual(
        sessions.map(({ origin, calls: rounds, executionId }) => ({
          origin,
          calls: rounds.length,
          executionId,
        })),
        [
          { origin: { kind: "new" }, calls: 2, executionId: detail.operations[2]?.executionId },
          { origin: { kind: "new" }, calls: 1, executionId: detail.operations[1]?.executionId },
        ],
      );
    } finally {
      await fixture.close();
    }
  }, 90_000);

  it("cancels a pending child through the existing execution lifecycle and preserves the journal", async () => {
    const fixture = await setupCodeStorage(kind, postgres.getConnectionUri());
    try {
      const trigger = await fixture.service().deploy("code-org", program());
      const started = await fixture.service().receive("code-org", trigger.triggerId, {
        id: "cancel",
        source: "manual",
        type: "run",
        receivedAt: new Date().toISOString(),
        payload: null,
      });
      assert.ok(started.run);
      await fixture.execute();
      await expect.poll(() => fixture.daemon.prompts.length).toBe(1);
      await fixture.service().cancel("code-org", started.run.id);
      assert.equal((await fixture.read(started.run.id)).status, "cancelled");
      await expect
        .poll(
          async () =>
            (
              await fixture
                .bundle()
                .runtime.query<{ status: string }>("select status from agent_executions")
            ).rows[0]?.status,
        )
        .toBe("failed");
      await fixture.restart();
      await fixture.service().tick();
      assert.equal((await fixture.read(started.run.id)).status, "cancelled");
      assert.equal(fixture.daemon.launches.length, 1);
    } finally {
      await fixture.close();
    }
  }, 90_000);
});

const literalPrompt = "Review precisely. Preserve literal ${{ unknown.value }} and @mentions.\n";
function program(): TriggerArtifact {
  const options = {
    target: "repository",
    agent: { provider: "codex", mode: "full-access", options: { sandbox_mode: "workspace-write" } },
    prompt: literalPrompt,
    maxRuntime: "1m",
    idleTimeout: "30s",
    output: {
      schema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  };
  const code = `export default {async run(ctx){ const first=await ctx.agent.run("first",${JSON.stringify(options)}); const second=await ctx.agent.run("second",${JSON.stringify(options)}); return {first:first.output,second:second.output}; }};`;
  const body = {
    format: "trigger-code-v1" as const,
    manifest: {
      name: "code-review",
      runner: "test",
      on: [{ source: "manual", event: "run" }],
      grants: {
        targets: { repository: { daemon: "devbox", cwd: "/workspace/test", providers: ["codex"] } },
      },
      limits: { maxRuntime: "1h", maxAgentRuns: 2 },
    },
    code,
    sources: [{ path: "trigger.js", content: code }],
  };
  return { ...body, digest: artifactDigest(body) };
}

/** Three rounds over two sessions: the first and last calls share a continuation key. */
function sessionProgram(): TriggerArtifact {
  const call = (id: string, prompt: string, key?: string) =>
    `await ctx.agent.run(${JSON.stringify(id)},${JSON.stringify({
      target: "repository",
      agent: { provider: "codex", mode: "full-access" },
      prompt,
      maxRuntime: "1m",
      idleTimeout: "30s",
      ...(key === undefined ? {} : { continuation: { key } }),
      output: {
        schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    })});`;
  const code = `export default {async run(ctx){ ${call("plan", "Plan the review.", "review")} ${call("check", "Check the tests.")} ${call("revise", "Revise the review.", "review")} return null; }};`;
  const body = {
    format: "trigger-code-v1" as const,
    manifest: {
      name: "review-rounds",
      runner: "test",
      on: [{ source: "manual", event: "run" }],
      grants: {
        targets: { repository: { daemon: "devbox", cwd: "/workspace/test", providers: ["codex"] } },
      },
      limits: { maxRuntime: "1h", maxAgentRuns: 3 },
    },
    code,
    sources: [{ path: "trigger.js", content: code }],
  };
  return { ...body, digest: artifactDigest(body) };
}

function memberAuth(): AuthServer {
  return {
    handle: () => Promise.resolve(new Response()),
    resources: () => Promise.reject(new Error("unused")),
    resolveOrganizationAccess: () => Promise.reject(new Error("unused")),
    resolveAccount: () =>
      Promise.resolve({
        session: { id: "code-session", activeOrganizationId: "code-org" },
        account: { id: "code-user", name: "Code user", email: "code-user@miko.test" },
        isInstanceOperator: false,
      }),
    rejectCookieMutation: () => undefined,
    close: () => Promise.resolve(),
  };
}

function interruptScheduledCommit(repository: import("./records.js").TriggerCodeRepository) {
  const transaction = repository.transaction.bind(repository);
  return vi.spyOn(repository, "transaction").mockImplementation((organization, operation) =>
    transaction(organization, async (tx) => {
      const persist = tx.putRun.bind(tx);
      tx.putRun = async (run) => {
        await persist(run);
        throw new Error("simulated interruption before commit");
      };
      return operation(tx);
    }),
  );
}
