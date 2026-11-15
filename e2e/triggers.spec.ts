import { testPipeline } from "../src/test-utils/pipeline.js";
import { expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";
import { artifactDigest } from "../src/triggers/code/contract.js";
import { executeTriggerJob } from "../src/triggers/code/runner.js";
import type { TriggerJob } from "../src/triggers/code/service.js";

const owner = {
  name: "Trigger Owner",
  email: "trigger-owner@example.com",
  password: "trigger-owner-test-password",
};

test("creates code projects without requiring a daemon for non-agent workflows", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Code projects");
  const triggers = new OrganizationTriggers(page);
  await triggers.open();
  await expect(page.getByText("No triggers", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New trigger" }).click();
  await expect(page.getByRole("heading", { name: "New trigger", exact: true })).toBeVisible();
  await expect(page.getByText("miko trigger init my-trigger", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save trigger" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Trigger YAML" })).toHaveCount(0);
  await page.getByRole("button", { name: "See the starter script" }).click();
  await expect(page.getByRole("textbox", { name: "trigger.ts value" })).toContainText(
    'name: "my-trigger"',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Copy commands", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("deploys code, runs a real worker, shows Activity results and retains identity on redeploy", async ({
  hub,
  page,
  request,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Code workflows");
  const deployed = await hub.deployCodeTrigger("owner", artifact("first"));
  const triggers = new OrganizationTriggers(page);
  await triggers.open();
  await page.getByRole("link", { name: "code-workflow", exact: true }).click();
  await expect(page.getByRole("region", { name: "Pipeline for code-workflow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source code", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Source code" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Code revision" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "trigger.ts value" })).toHaveCount(0);
  const triggerFile = page.getByRole("button", { name: "trigger.ts Entrypoint", exact: true });
  const policyFile = page.getByRole("button", { name: "policy.ts", exact: true });
  await expect(triggerFile).toHaveAttribute("aria-expanded", "false");
  await expect(policyFile).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("combobox", { name: "Source file" })).toHaveCount(0);
  await triggerFile.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("return result;", { exact: false })).toBeVisible();
  await policyFile.click();
  await expect(page.getByRole("textbox", { name: "policy.ts value" })).toContainText(
    'version = "first"',
  );
  await expect(page.getByRole("textbox", { name: "trigger.ts value" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await triggerFile.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("textbox", { name: "trigger.ts value" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "policy.ts value" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("button", { name: "Run now" })).toBeEnabled();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("Run queued", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Run history" }).getByRole("row").filter({ hasText: "Queued" }),
  ).toHaveCount(1);

  const operator = await hub.codeTriggerCredential("owner");
  const url = hub.primaryApplication().origin;
  const enrollment = await request.post(`${url}/api/v1/triggers/runners`, {
    headers: { authorization: `Bearer ${operator}` },
    data: { name: "browser" },
  });
  expect(enrollment.status()).toBe(201);
  const runner = (await enrollment.json()) as { token: string };
  const lease = await request.post(`${url}/api/v1/triggers/runner/lease`, {
    headers: { authorization: `Bearer ${runner.token}` },
    data: {},
  });
  const { job } = (await lease.json()) as { job: TriggerJob };
  expect(job.run.triggerId).toBe(deployed.triggerId);
  const directory = await mkdtemp(join(tmpdir(), "hub-browser-runner-"));
  try {
    await executeTriggerJob(job, { url, token: runner.token, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const history = page.getByRole("table", { name: "Run history" });
  await expect(history.getByRole("row").filter({ hasText: "Succeeded" })).toHaveCount(1);
  await history.getByRole("link", { name: /^Open run from / }).click();
  await expect(page.getByRole("radio", { name: "Run details", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Trigger result", exact: true })).toContainText(
    '"version": "first"',
  );
  const runUrl = page.url();
  const runPipeline = page.getByRole("region", { name: "Run pipeline" });
  await expect(runPipeline.locator("[data-pipeline-node]")).toHaveCount(3);
  await expect(runPipeline.locator('[data-pipeline-node="step-0"]')).toContainText("Process first");
  await expect(runPipeline.locator('[data-pipeline-node="step-0"]')).toContainText("Completed");
  const steps = page.getByRole("table", { name: "Steps" });
  await expect(steps.getByRole("row").filter({ hasText: "process" })).toContainText("Code step");
  await expect(page.getByRole("table", { name: "Agent sessions" })).toHaveCount(0);
  await steps.getByRole("button", { name: "process", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Diagnostics", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "process data", exact: true })).toContainText(
    '"version": "first"',
  );

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "code-workflow" });
  await expect(row).toContainText("Succeeded");
  await row.getByRole("link", { name: "code-workflow", exact: true }).click();
  await page.getByRole("radio", { name: "Run details", exact: true }).click();
  await expect(page.getByText('"version": "first"', { exact: false }).first()).toBeVisible();
  await page.getByRole("radio", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByText("Processed code workflow", { exact: false })).toBeVisible();

  const updated = await hub.deployCodeTrigger("owner", artifact("second"));
  expect(updated.triggerId).toBe(deployed.triggerId);
  expect(updated.version).toBe(2);
  await page.goto(runUrl);
  await expect(page.getByRole("region", { name: "Run pipeline" })).toContainText("Process first");
  await expect(page.getByRole("region", { name: "Run pipeline" })).not.toContainText(
    "Process second",
  );
  await page.getByRole("button", { name: "Expand pipeline", exact: true }).click();
  const expandedPipeline = page.getByRole("dialog", { name: "Pipeline", exact: true });
  await expandedPipeline.getByRole("button", { name: /Process first/u }).click();
  await expect(expandedPipeline).not.toBeVisible();
  await expect(page.getByRole("radio", { name: "Diagnostics", exact: true })).toBeChecked();
  await expect(page.getByRole("region", { name: "Run pipeline" })).toBeVisible();
  await triggers.open();
  await page.getByRole("link", { name: "code-workflow", exact: true }).click();
  await policyFile.click();
  await expect(page.getByText('"second"', { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Code revision" }).click();
  await page.getByRole("option", { name: /Revision 1/ }).click();
  await expect(policyFile).toHaveAttribute("aria-expanded", "false");
  await policyFile.click();
  await expect(page.getByText('"first"', { exact: false })).toBeVisible();
  await expect(
    page.getByText("This is an older revision. Run now uses the current revision, 2."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "Code revision" }).click();
  await page.getByRole("option", { name: /Revision 2/ }).click();
  await policyFile.click();
  await expect(page.getByText('"second"', { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();
});

test("shows explicit branches and loops in a shared Pipeline in both palettes and on a phone", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Workflow pipelines");
  const base = artifact("pipeline");
  const pipeline: import("../src/triggers/code/sdk.js").TriggerPipeline = {
    nodes: [
      { id: "event", kind: "event", label: "Incoming event", description: "Receive a PR event." },
      {
        id: "review",
        kind: "step",
        label: "Review",
        description: "Review the current head.",
        operations: ["process"],
      },
      { id: "ready", kind: "decision", label: "Ready?", description: "Check unresolved findings." },
      {
        id: "repair",
        kind: "agent",
        label: "Repair",
        description: "Repair findings and push a new head.",
        operations: ["repair:*"],
      },
      {
        id: "done",
        kind: "outcome",
        label: "Publish result",
        description: "Return the verified Review.",
      },
    ],
    edges: [
      { from: "event", to: "review" },
      { from: "review", to: "ready" },
      { from: "ready", to: "repair", label: "Findings remain" },
      { from: "ready", to: "done", label: "No findings" },
      { from: "repair", to: "review", label: "New head", loop: true },
    ],
  };
  const { digest: _digest, ...body } = {
    ...base,
    manifest: { ...base.manifest, name: "review-flow", pipeline },
  };
  await hub.deployCodeTrigger("owner", { ...body, digest: artifactDigest(body) });
  const triggers = new OrganizationTriggers(page);
  await triggers.open();
  await page.getByRole("link", { name: "review-flow", exact: true }).click();
  const graph = page.getByRole("region", { name: "Pipeline for review-flow" });
  await expect(graph.locator("[data-pipeline-node]")).toHaveCount(5);
  await expect(graph.locator("[data-pipeline-edge]")).toHaveCount(5);
  await expect
    .poll(() => graph.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(1);
  const expand = page.getByRole("button", { name: "Expand pipeline", exact: true });
  await expect
    .poll(() =>
      expand.evaluate((button) => {
        const card = button.closest("section")!;
        const viewport = card.querySelector('[role="region"]')!;
        const bounds = button.getBoundingClientRect();
        const surface = card.getBoundingClientRect();
        return (
          bounds.top - surface.top <= 20 &&
          surface.right - bounds.right <= 20 &&
          surface.height - viewport.getBoundingClientRect().height <= 35
        );
      }),
    )
    .toBe(true);
  const entry = graph.locator('[data-pipeline-node="event"]');
  await expect
    .poll(async () => {
      const first = await entry.boundingBox();
      const next = await graph.locator('[data-pipeline-node="review"]').boundingBox();
      return first !== null && next !== null && next.x > first.x;
    })
    .toBe(true);
  await expect(graph.getByRole("list", { name: "Pipeline connections" })).toContainText(
    "Repair → Review: New head (loop)",
  );
  const node = graph.locator('[data-pipeline-node="review"] > div');
  await expect(node).not.toContainText("Review the current head.");
  await expect(node).toHaveCSS("height", "44px");
  await node.hover();
  await expect(page.getByRole("tooltip")).toContainText("Review the current head.");
  await page.mouse.move(0, 0);
  await node.focus();
  await expect(page.getByRole("tooltip")).toContainText("Review the current head.");
  await page.keyboard.press("Escape");
  const color = await node.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(color);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(graph).toBeVisible();
  await expect
    .poll(() => graph.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(1);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await graph.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => graph.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({
    path: "e2e/screenshots/pipeline/trigger-mobile-dark.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Expand pipeline", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pipeline", exact: true });
  await expect(dialog.locator("[data-pipeline-node]")).toHaveCount(5);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          Math.abs(bounds.left) < 1 &&
          Math.abs(bounds.top) < 1 &&
          Math.abs(bounds.width - window.innerWidth) < 1 &&
          Math.abs(bounds.height - window.innerHeight) < 1
        );
      }),
    )
    .toBe(true);
  await expect(dialog).toContainText("Publish result");
  await dialog.getByRole("button", { name: "Fit pipeline", exact: true }).click();
  const expandedGraph = dialog.getByRole("region", { name: "Pipeline for review-flow" });
  await expect
    .poll(() =>
      expandedGraph.evaluate((element) => element.clientHeight >= window.innerHeight - 180),
    )
    .toBe(true);
  await expect
    .poll(() =>
      expandedGraph.evaluate((element) =>
        Math.max(
          element.scrollHeight - element.clientHeight,
          element.scrollWidth - element.clientWidth,
        ),
      ),
    )
    .toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reset zoom", exact: true })).toHaveText("100%");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await graph.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: "e2e/screenshots/pipeline/trigger-desktop-dark.png",
    animations: "disabled",
  });
  await expand.click();
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          Math.abs(bounds.left) < 1 &&
          Math.abs(bounds.top) < 1 &&
          Math.abs(bounds.width - window.innerWidth) < 1 &&
          Math.abs(bounds.height - window.innerHeight) < 1
        );
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
});

function artifact(version: string) {
  const code = `export default {async run(ctx) { const result = await ctx.step("process", null, async () => ({version:${JSON.stringify(version)}})); await ctx.log("Processed code workflow", result); return result; }};`;
  const body = {
    format: "trigger-code-v1" as const,
    manifest: {
      pipeline: {
        ...testPipeline("process"),
        nodes: testPipeline("process").nodes.map((node) =>
          node.id === "step-0" ? { ...node, label: "Process " + version } : node,
        ),
      },
      name: "code-workflow",
      runner: "browser",
      description: "A code-defined workflow",
      on: [{ source: "manual", event: "run" }],
      grants: {},
      limits: { maxRuntime: "10m" },
    },
    code,
    entrypoint: "trigger.ts",
    sources: [
      { path: "policy.ts", content: `export const version = ${JSON.stringify(version)};` },
      { path: "trigger.ts", content: code },
    ],
  };
  return { ...body, digest: artifactDigest(body) };
}
