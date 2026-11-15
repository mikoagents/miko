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

for (const action of ["select", "create"] as const) {
  test(`hides account actions when ${action} cannot refresh the account`, async ({ hub, page }) => {
    test.setTimeout(120_000);
    const owner = {
      name: "Refresh owner",
      email: `auth-refresh-${action}@example.com`,
      password: "auth-navigation-password",
    };
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    if (action === "select") {
      await hub.createAnotherOrganization("owner", "Orbit");
      await hub.chooseOrganization("owner", "Acme");
    }
    const application = hub.primaryApplication();
    // The account read joins invitations. Organization commands and the session do not.
    await application.query("alter table invitation rename to review_unavailable_invitation");
    try {
      if (action === "select") {
        await page.getByRole("button", { name: "Organization", exact: true }).click();
        await page.getByRole("menuitem", { name: "Orbit", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Organization", exact: true }).click();
        await page.getByRole("menuitem", { name: "New organization", exact: true }).click();
        const form = page.getByRole("form", { name: "Create organization", exact: true });
        await form.getByLabel("Organization name", { exact: true }).fill("Orbit");
        await form.getByRole("button", { name: "Create organization", exact: true }).click();
      }
      await expect(page).toHaveURL(/\/o\/orbit-[^/]+\/home$/u, { timeout: 30_000 });
      await expect(
        page.getByRole("heading", { name: "Sign in to Miko Hub", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("People with access to Acme.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Machine access for Acme.", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create API key", exact: true })).toHaveCount(
        0,
      );
      const active = await application.query(
        `select organization.name as name
         from session
         join organization on organization.id = session.active_organization_id
         join "user" on "user".id = session.user_id
         where "user".email = $1`,
        [owner.email],
      );
      expect(active.map((row) => row["name"])).toEqual(["Orbit"]);
    } finally {
      await application.query("alter table review_unavailable_invitation rename to invitation");
    }
  });
}

test("hides account actions when an inactive invitation snapshot matches the destination", async ({
  hub,
  page,
}) => {
  test.setTimeout(120_000);
  const owner = {
    name: "Invitation owner",
    email: "auth-invitation-cache@example.com",
    password: "auth-navigation-password",
  };
  const inviter = {
    name: "Orbit owner",
    email: "auth-invitation-inviter@example.com",
    password: "auth-navigation-password",
  };
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.signUpAs("inviter", inviter);
  await hub.createOrganization("inviter", "Orbit");
  const invitation = await hub.inviteMember("inviter", owner.email, "admin");
  await hub.openInvitation("owner", invitation);
  await hub.acceptInvitation("owner");

  const marker = "auth-invitation-cache-document";
  await page.evaluate((value) => Reflect.set(window, value, true), marker);
  await hub.chooseOrganization("owner", "Acme");
  expect(await page.evaluate((value) => Reflect.get(window, value), marker)).toBe(true);

  const application = hub.primaryApplication();
  await application.query("alter table invitation rename to review_unavailable_invitation");
  try {
    await page.getByRole("button", { name: "Organization", exact: true }).click();
    await page.getByRole("menuitem", { name: "Orbit", exact: true }).click();
    await expect(page).toHaveURL(/\/o\/orbit-[^/]+\/home$/u, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Sign in to Miko Hub", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("People with access to Acme.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Machine access for Acme.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create API key", exact: true })).toHaveCount(0);
    expect(await page.evaluate((value) => Reflect.get(window, value), marker)).not.toBe(true);
    const active = await application.query(
      `select organization.name as name
       from session
       join organization on organization.id = session.active_organization_id
       join "user" on "user".id = session.user_id
       where "user".email = $1`,
      [owner.email],
    );
    expect(active.map((row) => row["name"])).toEqual(["Orbit"]);
  } finally {
    await application.query("alter table review_unavailable_invitation rename to invitation");
  }
});
