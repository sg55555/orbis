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

// リッチ化本体（A: タブバー上端オーロラ線）を実装事実としてロック。
// off は base のまま＝::before 無し（content:none）。a は線あり（content:'""'）。
test('mui-a: タブバー上端のオーロラ細線(::before)が出る・mui-off は出ない', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=a');
  await ready(page);
  const a = await page.locator('#mobile-tabs').evaluate((el) => getComputedStyle(el, '::before').content);
  expect(a).not.toBe('none');

  await page.goto('/?mui=off');
  await ready(page);
  const off = await page.locator('#mobile-tabs').evaluate((el) => getComputedStyle(el, '::before').content);
  expect(off).toBe('none');
});

// mui-b が mui-a と視覚的に別物であることをロック（C: ディマー幕の濃度差＝a==b 退行を防ぐ）。
test('mui-b は mui-a と別バリアント（ディマー幕の濃度が異なる）', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=a');
  await ready(page);
  const aScrim = await page.locator('#sheet-scrim').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.goto('/?mui=b');
  await ready(page);
  const bScrim = await page.locator('#sheet-scrim').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(aScrim).not.toBe(bScrim);
});

// リッチ化本体（B: 見出しオーロラ下線）を実装事実としてロック。
// 下線は .panel-head に付与＝mui-a で 1px・mui-off は base のまま 0px。
test('mui-a: シート見出し(.panel-head)に下線・mui-off は無し', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=a');
  await ready(page);
  const a = await page.locator('#panel .panel-head').first().evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(a).toBe('1px');

  await page.goto('/?mui=off');
  await ready(page);
  const off = await page.locator('#panel .panel-head').first().evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(off).toBe('0px');
});

// a/b のファーストビュー差（非アクティブタブ枠の明度差）をロック＝シート展開前でも a/b を判別可能。
test('mui-b: 非アクティブタブ枠が mui-a と異なる（ファーストビューの a/b 差）', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=a');
  await ready(page);
  const aBorder = await page.locator('.mobile-tab[aria-expanded="false"]').first().evaluate((el) => getComputedStyle(el).borderTopColor);
  await page.goto('/?mui=b');
  await ready(page);
  const bBorder = await page.locator('.mobile-tab[aria-expanded="false"]').first().evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(aBorder).not.toBe(bBorder);
});
