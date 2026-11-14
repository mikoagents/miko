import { expect } from "@playwright/test";
import { test } from "./app.js";
import { holdPageData } from "./helpers/pending-navigation.js";
import { projectApp } from "./helpers/projects/index.js";

const owner = {
  name: "Skeleton owner",
  email: "skeleton-owner@example.com",
  password: "skeleton-owner-password",
};

test("draws provider cards and real table columns while their first reads are delayed", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Skeleton workspace");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

  const cards = await holdPageData(page);
  try {
    await projectApp(page).navigation.openOrganizationSection("Connections");
    await cards.requested;
    await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
    for (const provider of ["GitHub", "Discord", "Slack", "Linear"]) {
      await expect(page.getByRole("heading", { name: provider, exact: true })).toBeVisible();
    }
    const sample = page.locator("[skullet-loading]").first();
    await expect(sample).toHaveAttribute("aria-hidden", "true");
    await expect(sample).toHaveAttribute("inert", "");
    await expect(page.getByText("Workflow record", { exact: true }).first()).toBeHidden();
  } finally {
    await cards.release();
  }
  await expect(page.locator("[skullet-loading]")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const table = await holdPageData(page);
  try {
    await projectApp(page).navigation.openMobileOrganizationSection("Activity");
    await table.requested;
    const activity = page.getByRole("table", { name: "Trigger activity", exact: true });
    await expect(activity).toBeVisible();
    await expect(
      activity.getByRole("columnheader", { name: "Trigger", exact: true }),
    ).toBeVisible();
    await expect(activity.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
    await expect(activity.locator("[data-slot=skeleton]").first()).toBeVisible();
    await expect(page.getByText("No activity yet", { exact: true })).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await table.release();
  }
  await expect(page.locator("[data-slot=skeleton]")).toHaveCount(0);
});

test("uses the app palette and keeps skeletons still under reduced motion", async ({
  hub,
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("miko-hub-theme", "dark"));
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Skeleton appearance");
  const data = await holdPageData(page);
  try {
    await projectApp(page).navigation.openOrganizationSection("Daemons");
    await data.requested;
    const bone = page.locator("[data-slot=skeleton] [skullet-bar]").first();
    await expect(bone).toBeVisible();
    const appearance = await bone.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--accent)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        actual: getComputedStyle(element).backgroundColor,
        expected,
        animations: element.getAnimations().length,
      };
    });
    expect(appearance.actual).toBe(appearance.expected);
    expect(appearance.animations).toBe(0);
  } finally {
    await data.release();
  }
});
