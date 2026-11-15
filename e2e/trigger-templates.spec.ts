import { testPipeline } from "../src/test-utils/pipeline.js";
import { expect } from "@playwright/test";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";
import { artifactDigest } from "../src/triggers/code/contract.js";
import { findTriggerTemplate, TRIGGER_TEMPLATES } from "../src/triggers/code/templates.js";

test("selects a built-in template and configures its source on desktop and mobile", async ({
  hub,
  page,
  context,
}) => {
  await hub.signUpAs("owner", {
    name: "Template Owner",
    email: "template-owner@example.com",
    password: "template-owner-test-password",
  });
  await hub.createOrganization("owner", "Trigger templates");
  await new OrganizationTriggers(page).open();
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(0);
  await page.getByRole("radio", { name: "Explore", exact: true }).click();
  await expect(page).toHaveURL(/scope=explore/u);
  await expect(page.getByRole("heading", { name: "Code quality", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(27);
  await expect(page.getByRole("status").filter({ hasText: "27 templates" })).toBeVisible();
  await page.getByRole("link", { name: "Preview Find critical bugs template" }).click();
  await expect(
    page.getByRole("heading", { name: "Find critical bugs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pipeline for find-bugs", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Events and access", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent calls", exact: true })).toBeVisible();
  await expect(page.getByText("your-daemon", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run history", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New trigger", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    /You are a deep bug-finding automation/u,
  );
  await page.getByRole("textbox", { name: "Runner", exact: true }).fill("browser-runner");
  const code = page.getByRole("textbox", { name: "trigger.ts updated value", exact: true });
  await expect(code).toContainText('name: "find-bugs"');
  await expect(code).toContainText("ctx.agent.run");
  await expect(code).toContainText("ctx.state.set");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy updated code", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('name: "find-bugs"');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(code).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("link", { name: "Choose another template" }).click();
  await page.getByRole("link", { name: "Preview Fix CI failures template" }).click();
  await expect(
    page.getByRole("region", { name: "Pipeline for ci-autofix", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  await page.getByRole("textbox", { name: "Runner", exact: true }).fill("browser-runner");
  await expect(code).toContainText("workflow_run.completed");
  await expect(code).toContainText("ciContext(ctx)");
  await expect(page.getByRole("button", { name: "Create trigger", exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("shows deployed template provenance and detects current, outdated and unavailable versions", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", {
    name: "Version Owner",
    email: "version-owner@example.com",
    password: "version-owner-test-password",
  });
  await hub.createOrganization("owner", "Template versions");
  const first = await hub.deployCodeTrigger("owner", versionedArtifact("daily-digest", "0.9.0"));
  await new OrganizationTriggers(page).open();
  await page.getByRole("link", { name: "templated-digest", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Template", exact: true })).toBeVisible();
  await expect(page.getByText("0.9.0", { exact: true })).toBeVisible();
  await expect(page.getByText("Update available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check and upgrade the local project" }).click();
  await expect(
    page.getByRole("textbox", { name: "Check and preview the upgrade value" }),
  ).toContainText("miko trigger template-status ./daily-digest/trigger.ts");
  await expect(
    page.getByRole("textbox", { name: "Apply the reviewed upgrade value" }),
  ).toContainText("trigger.upgrade-" + findTriggerTemplate("daily-digest")!.version + ".ts");
  const updated = await hub.deployCodeTrigger(
    "owner",
    versionedArtifact("daily-digest", findTriggerTemplate("daily-digest")!.version),
  );
  expect(updated.triggerId).toBe(first.triggerId);
  await page.reload();
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
  await hub.deployCodeTrigger("owner", versionedArtifact("retired-template", "1.0.0"));
  await page.reload();
  await expect(page.getByText("Template unavailable", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check and upgrade the local project" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("groups the catalog by category, searches and previews repository-free, relayed and PR templates", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", {
    name: "Catalog Owner",
    email: "catalog-owner@example.com",
    password: "catalog-owner-test-password",
  });
  await hub.createOrganization("owner", "Complete template catalog");
  await new OrganizationTriggers(page).open();
  await page.getByRole("radio", { name: "Explore", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search templates", exact: true });
  for (const id of ["product-finance-agent", "investigate-sentry-issues", "assign-pr-reviewers"]) {
    const template = findTriggerTemplate(id)!;
    await search.fill(template.name);
    await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(1);
    await page.getByRole("link", { name: `Preview ${template.name} template` }).click();
    await expect(
      page.getByRole("region", { name: `Pipeline for ${template.id}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent calls", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Use template", exact: true }).click();
    await page.getByRole("textbox", { name: "Runner", exact: true }).fill("browser-runner");
    const code = page.getByRole("textbox", { name: "trigger.ts updated value", exact: true });
    if (id === "product-finance-agent") {
      await expect(code).toContainText("workspace: { daemon: settings.daemon");
      await expect(code).not.toContainText('github: "repository"');
      await expect(page.locator("p").filter({ hasText: /^Configure Stripe MCP/u })).toContainText(
        "Stripe",
      );
    } else if (id === "investigate-sentry-issues") {
      await expect(code).toContainText('source: "sentry"');
      await expect(
        page.getByText(
          "Automatic sentry events need an event relay to Hub. Manual runs remain available.",
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      await expect(code).toContainText("pull_request.opened");
      await expect(code).toContainText('mode: "checkout-pr"');
      await expect(code).toContainText('"pull_requests":"write"');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await page.getByRole("link", { name: "Choose another template" }).click();
  }
  await search.fill("no-template-matches-this-query");
  await expect(page.getByText("No matching templates", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(0);
  await search.fill("");
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(
    TRIGGER_TEMPLATES.length,
  );
  for (const category of ["Code quality", "Security", "DevOps", "Team", "Product & business"]) {
    await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  await search.fill("finance");
  await expect(
    page.getByRole("heading", { name: "Product & business", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(1);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("radio", { name: "Mine", exact: true }).click();
  await expect(search).toHaveCount(0);
  await page.getByRole("radio", { name: "Explore", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Preview .+ template$/u })).toHaveCount(
    TRIGGER_TEMPLATES.length,
  );
  await page.reload();
  await expect(page.getByRole("radio", { name: "Explore", exact: true })).toBeChecked();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

function versionedArtifact(id: string, version: string) {
  const manifest = {
    pipeline: testPipeline(),
    name: "templated-digest",
    template: { id, version },
    runner: "local",
    on: [{ source: "manual", event: "run" }],
    grants: {},
    limits: { maxRuntime: "1m" },
  };
  const code = `export default { ...${JSON.stringify(manifest)}, async run() { return null; } };`;
  const body = {
    format: "trigger-code-v1" as const,
    manifest,
    code,
    entrypoint: "trigger.ts",
    sources: [{ path: "trigger.ts", content: code }],
  };
  return { ...body, digest: artifactDigest(body) };
}
