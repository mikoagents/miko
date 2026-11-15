import { expect } from "@playwright/test";
import { test } from "./app.js";
import { projectApp } from "./helpers/projects/index.js";
import { holdPageData } from "./helpers/pending-navigation.js";

const owner = {
  name: "Navigation owner",
  email: "auth-navigation@example.com",
  password: "auth-navigation-password",
};

test("renders the authenticated shell before browser scripts run on a direct visit", async ({
  hub,
  page,
  browser,
  context,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  const destination = await page
    .getByRole("navigation", { name: "Organization", exact: true })
    .getByRole("link", { name: "Daemons", exact: true })
    .getAttribute("href");
  expect(destination).not.toBeNull();
  const withoutScripts = await browser.newContext({
    storageState: await context.storageState(),
    javaScriptEnabled: false,
  });
  try {
    const direct = await withoutScripts.newPage();
    await direct.goto(new URL(destination!, page.url()).href);
    await expect(
      direct.getByRole("navigation", { name: "Organization", exact: true }),
    ).toBeVisible();
    await expect(direct.getByRole("button", { name: "Organization", exact: true })).toContainText(
      "Acme",
    );
    await expect(direct.getByRole("main", { name: "Loading Miko Hub", exact: true })).toBeHidden();
    await expect(direct.getByRole("heading", { name: "Sign in", exact: true })).toBeHidden();
  } finally {
    await withoutScripts.close();
  }

  const data = await holdPageData(page);
  try {
    await page.goto(new URL(destination!, page.url()).href);
    await data.requested;
    await expect(page.getByRole("navigation", { name: "Organization", exact: true })).toBeVisible();
    await expect(page.getByRole("main", { name: "Loading Miko Hub", exact: true })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeHidden();
  } finally {
    await data.release();
  }
  await expect(page.getByRole("heading", { name: "Daemons", exact: true, level: 1 })).toBeVisible();
});

test("keeps the document through page navigation, organization creation and switching", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  const marker = "auth-navigation-document";
  await page.evaluate((value) => Reflect.set(window, value, true), marker);

  await projectApp(page).navigation.openOrganizationSection("Daemons");
  await expect(page.getByRole("heading", { name: "Daemons", exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate((value) => Reflect.get(window, value), marker)).toBe(true);

  await hub.createAnotherOrganization("owner", "Orbit");
  await expect(page.getByRole("heading", { name: "Home", exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate((value) => Reflect.get(window, value), marker)).toBe(true);

  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page.getByRole("menuitem", { name: "Acme", exact: true }).click();
  await expect(page.getByRole("button", { name: "Organization", exact: true })).toContainText(
    "Acme",
  );
  await expect(page.getByRole("heading", { name: "Home", exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate((value) => Reflect.get(window, value), marker)).toBe(true);
});
