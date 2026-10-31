import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { PlacesFile } from "../../src/data/places";

interface GoirtProbe {
  map: {
    getStyle(): { layers?: Array<{ id: string }> };
    getSource(id: string): unknown;
    getZoom(): number;
    getCenter(): { lng: number; lat: number };
    isMoving(): boolean;
    isSourceLoaded(id: string): boolean;
  };
  fieldsReady: boolean;
  overviewReady: boolean;
}

function placeFile(): PlacesFile {
  const path = new URL("../../public/data/places-sample.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf-8")) as PlacesFile;
}

const places = placeFile();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __goirt?: GoirtProbe }).__goirt?.fieldsReady &&
          (window as unknown as { __goirt?: GoirtProbe }).__goirt?.overviewReady,
      ),
    undefined,
    { timeout: 20_000 },
  );
}

function option(page: Page, label: string) {
  return page
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(label)}`) })
    .first();
}

async function openLocation(page: Page) {
  const input = page.getByRole("combobox", { name: "Search places" });
  await input.click();
  await expect(page.getByRole("listbox", { name: "Location search results" })).toBeVisible();
  return input;
}

async function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return {
      center: map.getCenter(),
      zoom: map.getZoom(),
      layers: (map.getStyle().layers ?? []).map((layer) => layer.id),
    };
  });
}

test("selects a Wexford place, recentres and adds no marker", async ({ page }) => {
  await ready(page);
  const input = await openLocation(page);
  const pill = page.locator("#location-search-pill");
  const enniscorthy = places.places.find((place) => place.name === "Enniscorthy");
  expect(enniscorthy).toBeDefined();

  await input.fill("enniscorthy");
  await expect(option(page, "Enniscorthy")).toBeVisible();
  await option(page, "Enniscorthy").click();
  await expect(pill).toContainText("Enniscorthy");
  await expect(page.getByRole("listbox", { name: "Location search results" })).toBeHidden();
  await expect(input).toHaveValue("");

  await page.waitForFunction(
    () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
    undefined,
    { timeout: 5_000 },
  );

  const state = await mapState(page);
  expect(state.zoom).toBeCloseTo(12, 1);
  expect(state.center.lng).toBeCloseTo(enniscorthy?.lon ?? 0, 2);
  expect(state.center.lat).toBeCloseTo(enniscorthy?.lat ?? 0, 2);
  expect(state.layers.some((id) => /marker|pin|place/i.test(id))).toBe(false);
  await expect(page.locator(".maplibregl-marker")).toHaveCount(0);
  await expect(page.locator("#location-search-live")).toContainText("selected");

  const beforeClear = state;
  await page.getByRole("button", { name: "Clear Enniscorthy selection" }).click();
  await expect(pill).toBeHidden();
  await expect(page.locator("#location-search-live")).toHaveText("Selection cleared.");

  const afterClear = await mapState(page);
  expect(afterClear.center.lng).toBeCloseTo(beforeClear.center.lng, 4);
  expect(afterClear.center.lat).toBeCloseTo(beforeClear.center.lat, 4);
  expect(afterClear.zoom).toBeCloseTo(beforeClear.zoom, 3);
});

test("fits a county bbox and shows the empty-query popular places", async ({
  page,
}) => {
  await ready(page);
  const input = await openLocation(page);
  const pill = page.locator("#location-search-pill");
  const listbox = page.getByRole("listbox", { name: "Location search results" });

  await expect(option(page, "Wexford")).toBeVisible();
  await expect(option(page, "Enniscorthy")).toBeVisible();
  const groupLabels = await page
    .locator("#location-search-listbox .search-group-label")
    .allTextContents();
  expect(groupLabels).toContain("Counties");
  expect(groupLabels).toContain("Towns and villages");

  await input.fill("wexford");
  const county = page
    .getByRole("option", { name: /^Wexford/ })
    .filter({ hasText: "County" });
  await county.first().click();
  await expect(pill).toContainText("Wexford");
  await expect(listbox).toBeHidden();
  await page.waitForFunction(
    () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
    undefined,
    { timeout: 5_000 },
  );
  const state = await mapState(page);
  expect(state.zoom).toBeGreaterThan(7);
  expect(state.zoom).toBeLessThan(11);
});

test("disables out-of-area places with a nationwide note", async ({ page }) => {
  await ready(page);
  const input = await openLocation(page);
  const before = await mapState(page);

  await input.fill("cork");
  const cork = page.getByRole("option", { name: /^Cork/ }).first();
  await expect(cork).toHaveAttribute("aria-disabled", "true");
  await expect(cork).toContainText("Available with the nationwide map");
  await cork.click({ force: true });

  await expect(page.locator("#location-search-pill")).toBeHidden();
  const after = await mapState(page);
  expect(after.center.lng).toBeCloseTo(before.center.lng, 5);
  expect(after.center.lat).toBeCloseTo(before.center.lat, 5);
  expect(after.zoom).toBeCloseTo(before.zoom, 4);
  await expect(page.locator("#location-search-status")).toContainText(
    "nationwide map",
  );
});

test("supports the location combobox keyboard and ARIA pattern", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search places" });
  const listbox = page.getByRole("listbox", { name: "Location search results" });
  const live = page.locator("#location-search-live");
  const pill = page.locator("#location-search-pill");

  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveAttribute("aria-controls", "location-search-listbox");
  await openLocation(page);

  await input.fill("wexford");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(live).toContainText("results available");

  await page.keyboard.press("ArrowDown");
  const first = await input.getAttribute("aria-activedescendant");
  expect(first).toBeTruthy();
  await expect(page.locator(`#${first}`)).toHaveAttribute("role", "option");
  await expect(page.locator(`#${first}`)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("End");
  const last = await input.getAttribute("aria-activedescendant");
  expect(last).not.toBe(first);

  await page.keyboard.press("Home");
  await expect(input).toHaveAttribute("aria-activedescendant", first ?? "");

  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");

  await input.fill("enniscorthy");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(pill).toContainText("Enniscorthy");
  await expect(input).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(pill).toBeHidden();

  await input.fill("gorey");
  await page.keyboard.press("Tab");
  await expect(listbox).toBeHidden();
  await expect(input).not.toBeFocused();
});

test("loads places once and makes no requests while typing", async ({ page }) => {
  await ready(page);
  const input = await openLocation(page);
  const listbox = page.getByRole("listbox", { name: "Location search results" });

  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  for (const query of ["wexford", "enniscorthy", "gorey", "new ross", "ferns"]) {
    await input.fill(query);
    await expect(listbox).toBeVisible();
  }

  const placeRequests = requests.filter((url) => /places|search|api\//i.test(url));
  expect(placeRequests).toEqual([]);
});
