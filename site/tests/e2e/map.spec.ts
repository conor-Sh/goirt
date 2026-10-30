import { expect, test } from "@playwright/test";

interface GoirtProbe {
  map: {
    getStyle(): { layers?: Array<{ id: string; minzoom?: number; type: string }> };
    getSource(id: string): unknown;
  };
  fieldsReady: boolean;
  fieldsCount: number;
}

test("loads the Wexford sample fields and the required attribution", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#attribution")).toContainText(
    "OpenStreetMap contributors",
  );
  await expect(page.locator("#attribution")).toContainText("Protomaps");
  await expect(page.locator("#attribution")).toContainText("DAFM LPIS");
  await expect(page.locator("#attribution")).toContainText(
    "Not endorsed by DAFM",
  );

  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __goirt?: GoirtProbe }).__goirt?.fieldsReady,
      ),
    undefined,
    { timeout: 20_000 },
  );

  const probe = await page.evaluate(() => {
    const goirt = (window as unknown as { __goirt?: GoirtProbe }).__goirt;
    if (!goirt) throw new Error("map probe missing");
    return {
      fieldsCount: goirt.fieldsCount,
      hasSource: Boolean(goirt.map.getSource("fields")),
      layers: (goirt.map.getStyle().layers ?? []).map((layer) => ({
        id: layer.id,
        type: layer.type,
        minzoom: layer.minzoom,
      })),
    };
  });

  expect(probe.fieldsCount).toBeGreaterThan(0);
  expect(probe.hasSource).toBe(true);

  const layerIds = probe.layers.map((layer) => layer.id);
  expect(layerIds).toContain("fields-fill-grassland");
  expect(layerIds).toContain("fields-outline");
  expect(layerIds).toContain("fields-selected-outline");
  expect(layerIds).toContain("fields-pattern-cereals");

  const patternLayer = probe.layers.find(
    (layer) => layer.id === "fields-pattern-cereals",
  );
  expect(patternLayer?.minzoom).toBe(12.5);

  await expect(page.locator("#map-error")).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test("shows an error when the crop lookup cannot load", async ({ page }) => {
  await page.route("**/data/crops.json", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "unavailable" }),
    }),
  );

  await page.goto("/");

  await expect(page.locator("#map-error")).toBeVisible();
  await expect(page.locator("#map-error")).toContainText(/crop lookup/i);
});

test("opens the data and licences dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Data & licences" }).click();

  const dialog = page.getByRole("dialog", { name: "Data & licences" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("CC BY 4.0");
  await expect(dialog).toContainText("Not endorsed by DAFM");
  await expect(dialog).toContainText("not claimed to be fully anonymous");

  await page.getByRole("button", { name: "Close data and licences" }).click();
  await expect(dialog).toBeHidden();
});
