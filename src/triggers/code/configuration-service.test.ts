import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, it } from "vitest";
import type { AuthServer } from "../../auth/server.js";
import { createMemoryDatabase } from "../../db/memory.js";
import { acceptingAgentValidator } from "../../test-utils/agent-validator.js";
import { TriggerDashboard } from "../dashboard.js";
import { buildTrigger } from "./build.js";
import type { TriggerArtifact } from "./contract.js";
import { triggerConfiguration } from "./editable-source.js";
import { TriggerCodeService } from "./service.js";
import { triggerStarter } from "./starter.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../../test-utils/project-configuration.js";
import { findTriggerTemplate } from "./templates.js";
import { templateConfigurationProject } from "./template-configuration.js";

let artifact: TriggerArtifact;
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "hub-config-service-"));
  try {
    await writeFile(join(directory, "trigger.ts"), triggerStarter("configuration"));
    artifact = await buildTrigger(join(directory, "trigger.ts"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(role: "owner" | "member" = "owner") {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: "org-1",
        organizationName: "Acme",
        organizationSlug: "acme",
        membershipId: "member-1",
        role,
      },
    ],
  });
  const service = new TriggerCodeService(database, {
    ensure: async () => {},
    cancel: async () => {},
    github: async () => null,
  });
  const deployed = await service.deploy("org-1", artifact);
  const dashboard = new TriggerDashboard(
    database,
    auth(),
    acceptingAgentValidator(),
    undefined,
    service,
  );
  const request = new Request("https://hub.test/o/acme/triggers");
  const runner = triggerConfiguration(artifact).fields.find((field) => field.label === "Runner")!;
  const scope = {
    organizationSlug: "acme",
    triggerId: deployed.triggerId,
    revisionId: deployed.revisionId,
    changes: [{ id: runner.id, value: "new-worker" }],
  };
  return { database, service, deployed, dashboard, request, scope };
}

describe("Trigger configuration revision boundary", () => {
  it("creates a configured template with its upgrade baseline and refuses duplicate names", async () => {
    const { database, dashboard, request, service } = await fixture();
    await enrollTestDaemon(database, "org-1");
    const template = findTriggerTemplate("product-finance-agent")!;
    const { configuration } = templateConfigurationProject(template);
    const daemon = configuration.fields.find((field) => field.label === "Daemon")!;
    const scope = {
      organizationSlug: "acme",
      templateId: template.id,
      name: "finance",
      changes: [{ id: daemon.id, value: TEST_DAEMON_SLUG }],
      save: true,
    };
    const created = await dashboard.createCodeFromTemplate(request, scope);
    assert.ok(created.deployed);
    const saved = await service.artifact(
      "org-1",
      created.deployed.triggerId,
      created.deployed.revisionId,
    );
    const baseline = saved.sources.find((file) => file.path === ".miko-template.json")!;
    assert.ok(baseline.content.includes('"name": "finance"'));
    assert.equal(saved.manifest.name, "finance");
    assert.equal(triggerConfiguration(saved).unavailable, null);
    await assert.rejects(dashboard.createCodeFromTemplate(request, scope), /name already exists/u);
    assert.equal(
      (await service.trigger("org-1", created.deployed.triggerId)).activeRevisionId,
      created.deployed.revisionId,
    );
  });
  it("previews without writing and saves a new revision while preserving enable state and accepted runs", async () => {
    const { database, service, dashboard, request, scope, deployed } = await fixture();
    const received = await service.dispatchManual("org-1", deployed.triggerId, {
      id: "before-edit",
      source: "manual",
      type: "run",
      receivedAt: new Date().toISOString(),
      payload: null,
    });
    const preview = await dashboard.configureCode(request, { ...scope, save: false });
    assert.equal(preview.deployed, null);
    assert.equal(preview.manifest.runner, "new-worker");
    assert.equal(
      (await service.trigger("org-1", deployed.triggerId)).activeRevisionId,
      deployed.revisionId,
    );
    // Use the current revision after changing enable state; the form never turns a disabled Trigger on.
    await service.setEnabled("org-1", deployed.triggerId, false);
    const current = await service.trigger("org-1", deployed.triggerId);
    const saved = await dashboard.configureCode(request, {
      ...scope,
      revisionId: current.activeRevisionId,
      save: true,
    });
    assert.ok(saved.deployed);
    assert.notEqual(saved.deployed.revisionId, deployed.revisionId);
    assert.equal((await service.trigger("org-1", deployed.triggerId)).enabled, false);
    const active = await service.artifact("org-1", deployed.triggerId, saved.deployed.revisionId);
    assert.equal(active.manifest.runner, "new-worker");
    assert.equal(
      (await service.artifact("org-1", deployed.triggerId, deployed.revisionId)).manifest.runner,
      "local",
    );
    const accepted = await database.triggerCode.transaction("org-1", (tx) =>
      tx.getRun(received.run!.id),
    );
    assert.equal(accepted?.revisionId, deployed.revisionId);
  });

  it("rejects stale edits, including two simultaneous saves based on the same revision", async () => {
    const { dashboard, request, scope, service, deployed } = await fixture();
    const outcomes = await Promise.allSettled([
      dashboard.configureCode(request, { ...scope, save: true }),
      dashboard.configureCode(request, { ...scope, save: true }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    await assert.rejects(
      dashboard.configureCode(request, { ...scope, save: true }),
      /newer revision/u,
    );
    assert.equal(
      (await service.list("org-1")).find((trigger) => trigger.id === deployed.triggerId)?.version,
      2,
    );
  });

  it("enforces resource validation, management permission and tenant isolation", async () => {
    const owner = await fixture();
    const events = triggerConfiguration(artifact).fields.find((field) => field.kind === "events")!;
    await assert.rejects(
      owner.dashboard.configureCode(owner.request, {
        ...owner.scope,
        changes: [
          {
            id: events.id,
            value: [{ source: "github", connection: "missing", event: "pull_request.opened" }],
          },
        ],
        save: true,
      }),
      /Connection is unavailable/u,
    );
    assert.equal(
      (await owner.service.trigger("org-1", owner.deployed.triggerId)).activeRevisionId,
      owner.deployed.revisionId,
    );
    const viewer = await fixture("member");
    await assert.rejects(
      viewer.dashboard.configureCode(viewer.request, { ...viewer.scope, save: true }),
      /forbidden/u,
    );
    await assert.rejects(
      viewer.dashboard.codeConfigurationResources(viewer.request, "acme"),
      /forbidden/u,
    );
    await assert.rejects(
      owner.dashboard.configureCode(owner.request, {
        ...owner.scope,
        organizationSlug: "other-organization",
        save: true,
      }),
    );
  });
});

function auth(): AuthServer {
  return {
    handle: () => Promise.resolve(new Response()),
    resources: () => Promise.reject(new Error("unused")),
    resolveOrganizationAccess: () => Promise.reject(new Error("unused")),
    resolveAccount: () =>
      Promise.resolve({
        session: { id: "session-1", activeOrganizationId: "org-1" },
        account: { id: "user-1", name: "User", email: "user@example.test" },
        isInstanceOperator: false,
      }),
    rejectCookieMutation: () => undefined,
    close: () => Promise.resolve(),
  };
}
