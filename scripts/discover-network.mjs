import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PRODUCT_URL, SELECTOR, VARIANTS } from '../src/config.mjs';
import {
  attachNetworkRecorder,
  dismissCommonCookieDialogs,
  ensureDirectory,
  saveDiagnostics,
  startRelevantNetworkTracker,
  waitForStableVariantState
} from '../src/browser-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'artifacts', 'network-discovery');
await ensureDirectory(outputDirectory);

const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin'
  });
  const page = await context.newPage();
  const records = await attachNetworkRecorder(page);

  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await dismissCommonCookieDialogs(page);

  for (const variant of VARIANTS) {
    const dropdown = page.locator(SELECTOR);

    if (variant.preselectValue) {
      const tracker = startRelevantNetworkTracker(page);
      try {
        await dropdown.selectOption({ value: variant.preselectValue });
        await tracker.waitForQuiet();
        await page.waitForTimeout(1_500);
      } finally {
        tracker.stop();
      }
    }

    const recordStart = records.length;
    const tracker = startRelevantNetworkTracker(page);
    let networkWait;
    try {
      await dropdown.selectOption({ value: variant.value });
      networkWait = await tracker.waitForQuiet();
    } finally {
      tracker.stop();
    }

    const snapshot = await waitForStableVariantState(page, variant);
    const variantRecords = records.slice(recordStart);

    await fs.writeFile(
      path.join(outputDirectory, `${variant.key}-snapshot.json`),
      JSON.stringify({ variant, networkWait, snapshot }, null, 2),
      'utf8'
    );
    await saveDiagnostics(page, outputDirectory, variant.key, variantRecords);
  }

  console.log(`Network diagnostics saved in ${outputDirectory}`);
  console.log('Close the browser window or press Ctrl+C when finished.');
  await page.waitForTimeout(15_000);
  await context.close();
} finally {
  await browser.close();
}
