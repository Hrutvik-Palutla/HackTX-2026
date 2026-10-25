import { test, expect } from "@playwright/test";

test("all preview screens share the shell, heading, panel and control system", async ({
  page,
}) => {
  const routes = [
    "/plans",
    "/friends",
    "/settings",
    "/login",
    "/signup",
    "/invite/sample",
    "/plans/friday",
    "/plans/friday/private",
    "/plans/friday/payment",
    "/studio",
  ];
  let reference:
    | {
        headerHeight: number;
        headingLeft: number;
        headingFont: string;
        headingWeight: string;
        panelRadius: string;
        panelBackground: string;
      }
    | undefined;
  for (const path of routes) {
    await page.goto(`${path}?preview=1`);
    await expect(page.locator(".notice")).toContainText("Preview");
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    const actual = await page.evaluate(() => {
      const header = document.querySelector(".app-header")!;
      const heading = document.querySelector(".page-heading h1")!;
      const panel = document.querySelector(".panel, .form-panel, .plan")!;
      const titleStyle = getComputedStyle(heading),
        surfaceStyle = getComputedStyle(panel);
      return {
        headerHeight: header.getBoundingClientRect().height,
        headingLeft: heading.getBoundingClientRect().left,
        headingFont: titleStyle.fontSize,
        headingWeight: titleStyle.fontWeight,
        panelRadius: surfaceStyle.borderRadius,
        panelBackground: surfaceStyle.backgroundColor,
      };
    });
    if (reference) expect(actual).toEqual(reference);
    else reference = actual;
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("reduced-motion preferences disable feedback transforms", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings?preview=1");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account saved");
  await expect
    .poll(() =>
      page
        .getByRole("status")
        .evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe("none");
});
