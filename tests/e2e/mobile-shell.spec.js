import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function ready(page) {
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });
}

test('mui-a: タブに線画SVGアイコンが出る・body に mui-a', async ({ page }) => {
  test.setTimeout(60000); // WebGL globe 起動が WSL2 で重い
  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveClass(/mui-a/);
  for (const s of ['layers', 'feed', 'legend']) {
    await expect(page.locator(`.mobile-tab[data-sheet="${s}"] svg.tab-svg`)).toBeVisible();
  }
});

test('mui-off: SVGは隠れ ≡ フォールバック（before）', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=off');
  await ready(page);
  await expect(page.locator('body')).toHaveClass(/mui-off/);
  await expect(page.locator('.mobile-tab[data-sheet="layers"] svg.tab-svg')).toBeHidden();
  const before = await page.locator('.mobile-tab[data-sheet="layers"]').evaluate(
    (el) => getComputedStyle(el, '::before').content
  );
  expect(before).toContain('≡');
});
