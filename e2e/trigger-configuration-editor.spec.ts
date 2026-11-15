import { expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";
import { buildTrigger } from "../src/triggers/code/build.js";
import { testPipeline } from "../src/test-utils/pipeline.js";

test("edits deployed source, resources, prompt and revision on a phone", async ({ hub, page }) => {
  await hub.signUpAs("owner", {
    name: "Editor Owner",
    email: "editor-owner@example.com",
    password: "editor-owner-test-password",
  });
  await hub.createOrganization("owner", "Configuration editor");
  const daemon = await hub.connectProviderDaemon("owner", "Configuration editor");
  const directory = await mkdtemp(join(tmpdir(), "hub-configuration-editor-"));
  try {
    await writeFile(
      join(directory, "trigger.ts"),
      [
        'import { defineTrigger } from "@mikoagents/hub/triggers";',
        `const settings = {runner:"browser-runner",daemon:${JSON.stringify(daemon)},cwd: "/workspace/app",agent:{provider:"codex",model:"custom-native-model"},prompt:"Summarize the important repository changes."};`,
        'export default defineTrigger({name:"configured-digest",runner:settings.runner,',
        `pipeline:${JSON.stringify(testPipeline("agent"))},`,
        'on:[{source:"manual",event:"run"}],grants:{targets:{work:{daemon:settings.daemon,cwd:settings.cwd,providers:[settings.agent.provider]}}},limits:{maxRuntime:"1h"},',
        'async run(ctx){return ctx.agent.run("agent",{target:"work",agent:settings.agent,prompt:settings.prompt});}});',
      ].join("\n"),
    );
    await hub.deployCodeTrigger("owner", await buildTrigger(join(directory, "trigger.ts")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  await new OrganizationTriggers(page).open();
  await page.getByRole("link", { name: "configured-digest", exact: true }).click();
  const form = page.getByRole("form", { name: "Trigger configuration" });
  await page.getByRole("button", { name: "Edit configuration", exact: true }).click();
  await form
    .getByRole("textbox", { name: "Working directory", exact: true })
    .fill("/workspace/updated");
  await form
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("A revised prompt with `code` and ${literal} text.");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Configuration saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Runs on", exact: true })).toContainText(
    "/workspace/updated",
  );
  await page.getByRole("combobox", { name: "Code revision", exact: true }).click();
  await page.getByRole("option", { name: /Revision 1/u }).click();
  await page.getByRole("button", { name: /^trigger\.ts/u }).click();
  await expect(page.getByRole("textbox", { name: "trigger.ts value", exact: true })).toContainText(
    'cwd: "/workspace/app"',
  );
  await page.getByRole("button", { name: "Edit configuration", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "Working directory", exact: true })).toHaveValue(
    "/workspace/updated",
  );
  await expect(form.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A revised prompt with `code` and ${literal} text.",
  );
  await form.getByRole("textbox", { name: "Working directory", exact: true }).fill("relative/path");
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  const failure = page.getByRole("alert").filter({ hasText: "Configuration not saved" });
  await expect(failure).toBeFocused();
  await expect(form.getByRole("textbox", { name: "Working directory", exact: true })).toHaveValue(
    "relative/path",
  );
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
