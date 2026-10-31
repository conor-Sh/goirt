import { expect, test, type Page } from "@playwright/test";

interface GoirtProbe {
  map: {
    getStyle(): { layers?: Array<{ id: string }> };
    getLayer(id: string): unknown;
    getFilter(id: string): unknown;
    getZoom(): number;
    getCenter(): { lng: number; lat: number };
    isMoving(): boolean;
    isSourceLoaded(id: string): boolean;
    jumpTo(options: { center: [number, number]; zoom: number }): void;
  };
  fieldsReady: boolean;
  fieldsCount: number;
  overviewReady: boolean;
}

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

test("finds crops, aliases and groups from the local crop index", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const listbox = page.getByRole("listbox", { name: "Crop search results" });

  await input.click();
  await expect(listbox).toBeVisible();
  await expect(option(page, "Barley")).toBeVisible();
  await expect(option(page, "Grass")).toBeVisible();
  await expect(option(page, "Break/root")).toBeVisible();

  await input.fill("barley");
  await expect(option(page, "Spring barley")).toBeVisible();
  await expect(option(page, "Winter barley")).toBeVisible();
  await expect(option(page, "All barley (2)")).toBeVisible();

  await input.fill("grass");
  await expect(option(page, "Grassland group")).toBeVisible();

  await input.fill("spuds");
  await expect(option(page, "Early potatoes")).toBeVisible();
  await expect(option(page, "Maincrop potatoes")).toBeVisible();
  await expect(option(page, "Seed potatoes")).toBeVisible();

  await input.fill("rape");
  await expect(option(page, "Spring oilseed rape")).toBeVisible();
  await expect(option(page, "Winter oilseed rape")).toBeVisible();

  await input.fill("beet");
  await expect(option(page, "Fodder Beet")).toBeVisible();
  await expect(option(page, "Sugar Beet")).toBeVisible();

  await input.fill("");
  await expect(option(page, "Barley")).toBeVisible();
  await expect(option(page, "Cereals")).toBeVisible();

  await input.fill("zzzz");
  await expect(page.locator("#crop-search-status")).toContainText(
    "No crops match",
  );
  await expect(option(page, "Clear search")).toBeVisible();
});

test("supports the combobox keyboard, ARIA and live-region pattern", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const listbox = page.getByRole("listbox", { name: "Crop search results" });
  const live = page.locator("#crop-search-live");
  const pill = page.locator("#crop-search-pill");

  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveAttribute("aria-controls", "crop-search-listbox");
  await expect(page.locator("#crop-search-listbox")).toHaveAttribute(
    "role",
    "listbox",
  );

  await input.fill("barley");
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

  await input.fill("maize");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(pill).toContainText("Maize");
  await expect(input).toHaveValue("");

  await input.fill("wheat");
  await page.keyboard.press("Tab");
  await expect(listbox).toBeHidden();
  await expect(input).not.toBeFocused();
});

test("highlights and fits a crop, then clears without resetting the viewport", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const pill = page.locator("#crop-search-pill");

  const before = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return { zoom: map.getZoom(), center: map.getCenter() };
  });

  await input.fill("maize");
  await option(page, "Maize").click();
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Maize");
  await expect(page.getByRole("listbox")).toBeHidden();

  await page.waitForFunction(
    () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
    undefined,
    { timeout: 5_000 },
  );

  const selected = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return {
      zoom: map.getZoom(),
      center: map.getCenter(),
      outline: JSON.stringify(map.getFilter("fields-search-outline")),
      dim: JSON.stringify(map.getFilter("fields-search-dim")),
      hasOverviewHighlight: Boolean(map.getLayer("overview-highlight")),
    };
  });

  expect(selected.zoom).toBeLessThanOrEqual(12.5);
  expect(selected.zoom).toBeGreaterThan(before.zoom);
  expect(selected.outline).toContain("crop_id");
  expect(selected.outline).toContain("44");
  expect(selected.dim).toContain("!");
  expect(selected.hasOverviewHighlight).toBe(false);

  await page.getByRole("button", { name: "Clear Maize selection" }).click();
  await expect(pill).toBeHidden();
  await expect(input).toHaveValue("");

  const cleared = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return {
      zoom: map.getZoom(),
      center: map.getCenter(),
      outline: JSON.stringify(map.getFilter("fields-search-outline")),
    };
  });

  expect(cleared.zoom).toBeCloseTo(selected.zoom, 3);
  expect(cleared.center.lng).toBeCloseTo(selected.center.lng, 5);
  expect(cleared.center.lat).toBeCloseTo(selected.center.lat, 5);
  expect(cleared.outline).toContain("-1");
});

test("highlights group overview dots and reports crops without mapped fields", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const pill = page.locator("#crop-search-pill");
  const status = page.locator("#crop-search-status");

  await input.fill("grass");
  await option(page, "Grassland group").click();
  await expect(pill).toContainText("Grassland group");

  await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    map.jumpTo({ center: [-6.58, 52.45], zoom: 6 });
  });

  const groupState = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return {
      hasHighlight: Boolean(map.getLayer("overview-highlight")),
      filter: JSON.stringify(map.getFilter("overview-highlight")),
    };
  });
  expect(groupState.hasHighlight).toBe(true);
  expect(groupState.filter).toContain("grassland");

  await page.getByRole("button", { name: "Clear Grassland group selection" }).click();

  await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    map.jumpTo({ center: [-6.58, 52.45], zoom: 10.2 });
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { __goirt: GoirtProbe }).__goirt.map.isSourceLoaded(
        "fields",
      ),
    undefined,
    { timeout: 5_000 },
  );

  await input.fill("barley");
  await option(page, "Spring barley").click();
  await expect(status).toContainText("No mapped fields for Spring barley in 2025");
  await expect(pill).toBeHidden();
});

test("fits a mapped crop before its field tiles render", async ({ page }) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const pill = page.locator("#crop-search-pill");
  const status = page.locator("#crop-search-status");

  await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    map.jumpTo({ center: [-6.58, 52.45], zoom: 6 });
  });

  await input.fill("maize");
  await option(page, "Maize").click();
  await expect(pill).toContainText("Maize");
  await expect(status).toBeHidden();

  await page.waitForFunction(
    () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
    undefined,
    { timeout: 5_000 },
  );

  const state = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return {
      zoom: map.getZoom(),
      outline: JSON.stringify(map.getFilter("fields-search-outline")),
      dim: JSON.stringify(map.getFilter("fields-search-dim")),
    };
  });

  expect(state.zoom).toBeGreaterThan(6);
  expect(state.zoom).toBeLessThanOrEqual(12.5);
  expect(state.outline).toContain("44");
  expect(state.dim).toContain("!");
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`keeps crop fits at the field minzoom at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await ready(page);
    const input = page.getByRole("combobox", { name: "Search crops and groups" });
    const pill = page.locator("#crop-search-pill");
    const status = page.locator("#crop-search-status");

    const cases = [
      { query: "permanent pasture", label: "Permanent Pasture", cropId: "24" },
      { query: "spring oats", label: "Spring oats", cropId: "36" },
    ];

    for (const entry of cases) {
      await input.fill(entry.query);
      await option(page, entry.label).click();
      await expect(pill).toContainText(entry.label);
      await expect(status).toBeHidden();
      await page.waitForFunction(
        () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
        undefined,
        { timeout: 5_000 },
      );

      const state = await page.evaluate(() => {
        const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
        return {
          zoom: map.getZoom(),
          outline: JSON.stringify(map.getFilter("fields-search-outline")),
        };
      });

      expect(state.zoom).toBeGreaterThanOrEqual(10);
      expect(state.zoom).toBeLessThanOrEqual(12.5);
      expect(state.outline).toContain(entry.cropId);

      await page
        .getByRole("button", { name: `Clear ${entry.label} selection` })
        .click();
      await expect(pill).toBeHidden();
    }
  });
}

test("clamps an over-wide crop fit to the field minzoom", async ({ page }) => {
  await page.route("**/data/crops.json", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      crops: Array<{ crop_id: number; bbox: number[] | null }>;
    };
    const crop = body.crops.find((entry) => entry.crop_id === 24);
    if (crop) crop.bbox = [-10.5, 51.4, -6, 55.4];
    await route.fulfill({ response, json: body });
  });
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const pill = page.locator("#crop-search-pill");
  const status = page.locator("#crop-search-status");

  await input.fill("permanent pasture");
  await option(page, "Permanent Pasture").click();
  await expect(pill).toContainText("Permanent Pasture");
  await expect(status).toBeHidden();
  await page.waitForFunction(
    () => !(window as unknown as { __goirt: GoirtProbe }).__goirt.map.isMoving(),
    undefined,
    { timeout: 5_000 },
  );

  const state = await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    return { zoom: map.getZoom(), center: map.getCenter() };
  });

  expect(state.zoom).toBeGreaterThanOrEqual(10);
  expect(state.zoom).toBeLessThan(10.5);
  expect(state.center.lng).toBeLessThan(-6.6);
  expect(state.center.lat).toBeGreaterThan(52.5);
});

test("reports a no-fields crop at low zoom from crop metadata", async ({
  page,
}) => {
  await ready(page);
  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  const pill = page.locator("#crop-search-pill");
  const status = page.locator("#crop-search-status");

  await page.evaluate(() => {
    const map = (window as unknown as { __goirt: GoirtProbe }).__goirt.map;
    map.jumpTo({ center: [-6.58, 52.45], zoom: 6 });
  });

  await input.fill("barley");
  await option(page, "Spring barley").click();

  await expect(status).toContainText("No mapped fields for Spring barley in 2025");
  await expect(pill).toBeHidden();
  const outline = await page.evaluate(() =>
    JSON.stringify(
      (window as unknown as { __goirt: GoirtProbe }).__goirt.map.getFilter(
        "fields-search-outline",
      ),
    ),
  );
  expect(outline).toContain("-1");
});

test("makes no crop or search network requests while typing", async ({
  page,
}) => {
  await ready(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const input = page.getByRole("combobox", { name: "Search crops and groups" });
  await input.click();
  for (const query of ["barley", "grass", "spuds", "rape", "beet", "wheat"]) {
    await input.fill(query);
    await expect(page.getByRole("listbox")).toBeVisible();
  }

  const searchRequests = requests.filter((url) =>
    /crops\.json|search|api\//i.test(url),
  );
  expect(searchRequests).toEqual([]);
});
