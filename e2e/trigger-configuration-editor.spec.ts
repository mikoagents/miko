import { expect } from "@playwright/test";
import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";

test("creates a configured template and edits its source, resources, prompt and revision on a phone", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", {
    name: "Editor Owner",
    email: "editor-owner@example.com",
    password: "editor-owner-test-password",
  });
  await hub.createOrganization("owner", "Configuration editor");
  const daemon = await hub.connectProviderDaemon("owner", "Configuration editor");
  await hub.seedGitHubConnection("Configuration editor", "acme-inc", ["acme-inc/app"]);
  await new OrganizationTriggers(page).open();
  await page.getByRole("radio", { name: "Explore", exact: true }).click();
  await page
    .getByRole("link", { name: "Preview Summarize changes daily template", exact: true })
    .click();
  await page.getByRole("link", { name: "Use template", exact: true }).click();
  const form = page.getByRole("form", { name: "Trigger configuration" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("configured-digest");
  await form.getByRole("textbox", { name: "Runner", exact: true }).fill("browser-runner");
  await form.getByRole("combobox", { name: "Daemon", exact: true }).click();
  await page.getByRole("option", { name: daemon, exact: true }).click();
  await form
    .getByRole("textbox", { name: "Working directory", exact: true })
    .fill("/workspace/app");
  await form.getByRole("combobox", { name: "GitHub connection", exact: true }).click();
  await page.getByRole("option", { name: "acme-inc", exact: true }).click();
  await form.getByRole("combobox", { name: "Repository", exact: true }).click();
  await page.getByRole("option", { name: "acme-inc/app", exact: true }).click();
  await form.getByRole("textbox", { name: "Slack channel", exact: true }).fill("C123");
  await form.getByRole("textbox", { name: "Model", exact: true }).fill("custom-native-model");
  await form
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Summarize the important repository changes.");
  const source = form.getByRole("textbox", { name: "trigger.ts updated value", exact: true });
  await expect(source).toContainText('"configured-digest"');
  await expect(source).toContainText('"custom-native-model"');
  await expect(source).toContainText("Summarize the important repository changes.");
  await form.getByRole("button", { name: "Check configuration", exact: true }).click();
  await expect(page.getByText("Configuration valid", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run history", exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Create trigger", exact: true }).click();
  await expect(page.getByRole("heading", { name: "configured-digest", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Runs on", exact: true })).toContainText(
    "/workspace/app",
  );
  await expect(page.getByRole("list", { name: "Agent calls", exact: true })).toContainText(
    "custom-native-model",
  );
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
