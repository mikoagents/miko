import { testPipeline } from "../src/test-utils/pipeline.js";
import { expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";
import { buildTrigger } from "../src/triggers/code/build.js";

test("shows deployed configuration without source prompts and keeps revision browsing independent", async ({
  hub,
  page,
}) => {
  // Forty letters and no break, the case that used to push the event column off a phone.
  const longRepository = `acme-inc/${"a".repeat(40)}`;
  await hub.signUpAs("owner", {
    name: "Code Configuration Owner",
    email: "configuration-owner@example.com",
    password: "configuration-owner-password",
  });
  await hub.createOrganization("owner", "Code Configuration");
  const daemon = await hub.connectProviderDaemon("owner", "Code Configuration");
  await hub.seedGitHubConnection("Code Configuration", "acme-inc", [
    "acme-inc/app",
    longRepository,
  ]);
  const directory = await mkdtemp(join(tmpdir(), "hub-visual-configuration-"));
  const source = [
    'import {defineTrigger} from "@mikoagents/hub/triggers";',
    'import {agent} from "./policy.js";',
    "export default defineTrigger({",
    `pipeline:${JSON.stringify(testPipeline("review", "recheck"))},`,
    'name:"visual-configuration",runner:"browser",',
    'on:[{source:"github",event:"pull_request.opened",connection:"acme-inc",resource:"acme-inc/app"},',
    `{source:"github",event:"issues.opened",connection:"acme-inc",resource:${JSON.stringify(longRepository)}},`,
    '{source:"github",event:"check_suite.completed",connection:"acme-inc"}],',
    "grants:{targets:{review:{daemon:" +
      JSON.stringify(daemon) +
      ',cwd:"/workspace/review",providers:["codex"]}},',
    'github:{reviews:{connection:"acme-inc",repositories:["acme-inc/app"],permissions:{contents:"read",pull_requests:"write"}},',
    'triage:{connection:"acme-inc",repositories:["acme-inc/app"],permissions:{contents:"read",issues:"write"}}}},',
    'limits:{maxRuntime:"1h",maxAgentRuns:2},',
    "async run(ctx){",
    'const first=await ctx.agent.run("review",{target:"review",agent,prompt:"Review this PR.",github:"reviews",maxRuntime:"50m",idleTimeout:"10m"});',
    'if(ctx.event.payload.recheck)await ctx.agent.run("recheck",{target:"review",agent:{provider:"codex",model:ctx.event.payload.model},prompt:ctx.event.payload.prompt,github:ctx.event.payload.full?"reviews":"triage",maxRuntime:"10m",idleTimeout:"5m"});',
    "return first;",
    "}});",
  ].join("\n");
  try {
    await writeFile(join(directory, "trigger.ts"), source);
    await writeFile(
      join(directory, "policy.ts"),
      'export const agent={provider:"codex",model:"model-v1",mode:"auto-review",thinkingOptionId:"max"};',
    );
    await hub.deployCodeTrigger("owner", await buildTrigger(join(directory, "trigger.ts")));
    const triggers = new OrganizationTriggers(page);
    await triggers.open();
    const listRow = page
      .getByRole("table", { name: "Triggers" })
      .getByRole("row")
      .filter({ hasText: "visual-configuration" });
    await expect(listRow).toContainText("codex/model-v1 · Computed at runtime");
    await expect(listRow).toContainText("GitHub pull request opened");
    await expect(listRow).toContainText("acme-inc");
    await expect(listRow).toContainText(daemon);
    await expect(listRow).toContainText("/workspace/review");
    await expect(listRow.getByRole("img", { name: "github provider" })).toBeVisible();
    await page.getByRole("link", { name: "visual-configuration", exact: true }).click();
    await expect(page.getByRole("button", { name: /^View .* source$/ })).toHaveCount(0);
    // Every group is open on arrival; only prompts fold.
    // One connection is one record, said once; each repository keeps its own events under it.
    const connections = page.getByRole("list", { name: "Events and access", exact: true });
    const events = connections.getByRole("listitem");
    await expect(events).toHaveCount(1);
    await expect(events).toContainText("acme-inc");
    await expect(events).toContainText("GitHub connection");
    const scopes = page.locator('[data-summary="acme-inc events"]');
    await expect(scopes.locator('dt:text-is("All repositories") + dd')).toHaveText(
      "Check suite completed",
    );
    await expect(scopes.locator('dt:text-is("acme-inc/app") + dd')).toHaveText(
      "Pull request opened",
    );
    await expect(scopes.locator(`dt:text-is("${longRepository}") + dd`)).toHaveText(
      "Issues opened",
    );
    const runsOn = page.getByRole("list", { name: "Runs on", exact: true });
    await expect(runsOn).toContainText("Workflow runner");
    const target = runsOn.getByRole("listitem").filter({ hasText: daemon });
    await expect(target).toContainText("/workspace/review");
    await expect(page.locator('[data-summary="review execution target"]')).toContainText("Codex");
    const config = page.locator('[data-summary="review agent configuration"]');
    const agent = config.locator("..");
    const reviewCall = page.getByRole("listitem").filter({ has: config });
    await expect(reviewCall).toContainText("Codex · model-v1");
    await expect(config).toContainText("auto-review");
    await expect(config).toContainText("max");
    await expect(config).toContainText("reviews");
    const recheck = page.locator('[data-summary="recheck agent configuration"]');
    // A model computed when the run starts shows the code that computes it; a grant the code
    // picks between two names shows both.
    await expect(page.getByRole("listitem").filter({ has: recheck })).toContainText(
      "Codex · ctx.event.payload.model",
    );
    await expect(recheck).toContainText("Provider default");
    await expect(recheck).toContainText("reviews or triage");
    const prompts = page.getByRole("button", { name: /^Prompt/ });
    await expect(prompts).toHaveCount(2);
    for (const prompt of await prompts.all())
      await expect(prompt).toHaveAttribute("aria-expanded", "false");
    await recheck
      .locator("..")
      .getByRole("button", { name: /^Prompt/ })
      .click();
    await expect(page.getByRole("textbox", { name: "recheck prompt", exact: true })).toHaveText(
      "ctx.event.payload.prompt",
    );
    // Both grants use one connection and reach the same repository, so that repository is said
    // once. A permission is said once too, and split by grant only where the grants differ.
    const access = connections.getByRole("listitem");
    await expect(access).toHaveCount(1);
    await expect(access).toContainText("acme-inc");
    await expect(access).toContainText("GitHub connection");
    const grants = page.locator('[data-summary="acme-inc grants"]');
    await expect(grants.locator("dt")).toHaveText("reviews, triage");
    await expect(grants.locator("dd")).toHaveText("acme-inc/app");
    const permissions = page.locator('[data-summary="acme-inc permissions"]');
    // Intake scope and grants share one connection record without widening either scope.
    await expect(events.locator('[data-summary="acme-inc events"]')).toBeVisible();
    await expect(events.locator('[data-summary="acme-inc grants"]')).toBeVisible();
    await expect(events.locator('[data-summary="acme-inc permissions"]')).toBeVisible();
    const level = (label: string) => permissions.locator(`dt:text-is("${label}") + dd`);
    await expect(level("Contents")).toHaveText("Read");
    await expect(level("Pull requests")).toHaveText("reviews Write · triage None");
    await expect(level("Issues")).toHaveText("reviews None · triage Write");
    await expect(page.getByRole("textbox", { name: "policy.ts value", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /^View .* source$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "policy.ts", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "policy.ts value", exact: true })).toBeVisible();

    await writeFile(
      join(directory, "policy.ts"),
      'export const agent={provider:"codex",model:"model-v2",mode:"auto-review",thinkingOptionId:"max"};',
    );
    await hub.deployCodeTrigger("owner", await buildTrigger(join(directory, "trigger.ts")));
    await page.reload();
    await expect(reviewCall).toContainText("model-v2");
    await page.getByRole("combobox", { name: "Code revision" }).click();
    await page.getByRole("option", { name: /Revision 1/ }).click();
    await page.getByRole("button", { name: "policy.ts", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "policy.ts value", exact: true })).toContainText(
      "model-v1",
    );
    await expect(reviewCall).toContainText("model-v2");
    await page.getByRole("combobox", { name: "Code revision" }).click();
    await page.getByRole("option", { name: /Revision 2/ }).click();
    await expect(page.getByRole("combobox", { name: "Code revision" })).toContainText("Revision 2");
    await page.getByRole("button", { name: "policy.ts", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "policy.ts value", exact: true })).toContainText(
      "model-v2",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(reviewCall).toContainText("model-v2");
    await expect(config).toContainText("max");
    await expect(permissions).toContainText("Pull requests");
    await expect(agent.getByRole("button", { name: /^Prompt/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("button", { name: /^View .* source$/ })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "policy.ts value", exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    // A long repository wraps inside its column. The event beside it stays on screen, and a short
    // repository still sits on the same row as its event.
    const shortName = scopes.locator('dt:text-is("acme-inc/app")');
    const shortEvents = scopes.locator('dt:text-is("acme-inc/app") + dd');
    const longName = scopes.locator(`dt:text-is("${longRepository}")`);
    const longEvents = scopes.locator(`dt:text-is("${longRepository}") + dd`);
    // Bring both cells into view before requiring the whole row to fit on a phone.
    await longName.scrollIntoViewIfNeeded();
    await longEvents.scrollIntoViewIfNeeded();
    await expect(longName).toBeInViewport({ ratio: 1 });
    await expect(longEvents).toBeInViewport({ ratio: 1 });
    const [shortNameBox, shortEventsBox, longNameBox, longEventsBox] = await Promise.all([
      shortName.boundingBox(),
      shortEvents.boundingBox(),
      longName.boundingBox(),
      longEvents.boundingBox(),
    ]);
    expect(shortNameBox).not.toBeNull();
    expect(shortEventsBox).not.toBeNull();
    expect(longNameBox).not.toBeNull();
    expect(longEventsBox).not.toBeNull();
    // Baseline alignment, not a shared top: the name is text-xs and the event is text-sm.
    expect(Math.abs(shortNameBox!.y - shortEventsBox!.y)).toBeLessThan(12);
    expect(longEventsBox!.y).toBeLessThan(longNameBox!.y + 12);
    expect(longEventsBox!.width).toBeGreaterThan(0);
    expect(longEventsBox!.x + longEventsBox!.width).toBeLessThanOrEqual(391);
    expect(longNameBox!.height).toBeGreaterThan(shortNameBox!.height + 4);
    expect(await longName.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    expect(await longEvents.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(
      0,
    );
    await agent.getByRole("button", { name: /^Prompt/ }).click();
    await expect(page.getByRole("textbox", { name: "review prompt", exact: true })).toContainText(
      "Review this PR.",
    );
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
