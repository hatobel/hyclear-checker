import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BANNER_SELECTOR,
  CART_BUTTON_SELECTOR,
  SELECTOR
} from './config.mjs';

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export function safeFilename(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

export async function attachNetworkRecorder(page) {
  const records = [];
  const startedAt = new Map();

  page.on('request', request => {
    const type = request.resourceType();
    if (!['xhr', 'fetch'].includes(type)) return;

    startedAt.set(request, Date.now());
    records.push({
      phase: 'request',
      timestamp: new Date().toISOString(),
      method: request.method(),
      resourceType: type,
      url: request.url(),
      postData: request.postData() ?? null,
      headers: request.headers()
    });
  });

  page.on('response', async response => {
    const request = response.request();
    const type = request.resourceType();
    if (!['xhr', 'fetch'].includes(type)) return;

    let bodyPreview = null;
    const contentType = response.headers()['content-type'] ?? '';
    if (/json|text|html|javascript/i.test(contentType)) {
      try {
        bodyPreview = (await response.text()).slice(0, 20_000);
      } catch {
        bodyPreview = null;
      }
    }

    records.push({
      phase: 'response',
      timestamp: new Date().toISOString(),
      method: request.method(),
      resourceType: type,
      url: response.url(),
      status: response.status(),
      durationMs: startedAt.has(request) ? Date.now() - startedAt.get(request) : null,
      contentType,
      bodyPreview
    });
  });

  return records;
}

export async function dismissCommonCookieDialogs(page) {
  const patterns = [
    /alle akzeptieren/i,
    /akzeptieren/i,
    /zustimmen/i,
    /accept all/i
  ];

  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first();
    try {
      if (await button.isVisible({ timeout: 500 })) {
        await button.click({ timeout: 2_000 });
        return;
      }
    } catch {
      // Cookie overlays are optional and do not affect selectOption().
    }
  }
}

async function readDomSnapshot(page) {
  return page.evaluate(
    ({ selectSelector, bannerSelector, buttonSelector }) => {
      const select = document.querySelector(selectSelector);
      const banner = document.querySelector(bannerSelector);
      const button = document.querySelector(buttonSelector);
      const selectedOption = select?.selectedOptions?.[0] ?? null;
      const bodyText = document.body?.innerText ?? '';
      const articleMatch = bodyText.match(/\(Art\.Nr\.:\s*([^\)\n]+)\)/i);

      const bannerStyle = banner ? window.getComputedStyle(banner) : null;
      const bannerVisible = Boolean(
        banner &&
          bannerStyle &&
          bannerStyle.display !== 'none' &&
          bannerStyle.visibility !== 'hidden' &&
          bannerStyle.opacity !== '0' &&
          (banner.getClientRects().length > 0 || bannerStyle.position === 'fixed')
      );

      return {
        selectedValue: select?.value ?? null,
        selectedLabel: selectedOption?.textContent?.trim() ?? null,
        articleNumber: articleMatch?.[1]?.trim() ?? null,
        bannerExists: Boolean(banner),
        bannerVisible,
        bannerText: banner?.textContent?.trim() ?? '',
        buttonExists: Boolean(button),
        buttonDisabled: Boolean(button?.disabled || button?.hasAttribute('disabled')),
        buttonClasses: button ? [...button.classList] : [],
        buttonTitle: button?.getAttribute('title') ?? null,
        pageUrl: location.href,
        pageTitle: document.title
      };
    },
    {
      selectSelector: SELECTOR,
      bannerSelector: BANNER_SELECTOR,
      buttonSelector: CART_BUTTON_SELECTOR
    }
  );
}

export async function waitForStableVariantState(page, variant, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let stableCount = 0;
  let lastSnapshot = null;

  while (Date.now() < deadline) {
    lastSnapshot = await readDomSnapshot(page);
    const signature = JSON.stringify({
      selectedValue: lastSnapshot.selectedValue,
      selectedLabel: lastSnapshot.selectedLabel,
      articleNumber: lastSnapshot.articleNumber,
      bannerVisible: lastSnapshot.bannerVisible,
      bannerText: lastSnapshot.bannerText,
      buttonDisabled: lastSnapshot.buttonDisabled,
      buttonClasses: lastSnapshot.buttonClasses
    });

    if (signature === previous) {
      stableCount += 1;
    } else {
      previous = signature;
      stableCount = 0;
    }

    const targetSelected =
      lastSnapshot.selectedValue === variant.value &&
      lastSnapshot.selectedLabel === variant.label;

    // Four identical samples at 500 ms distance avoid reading the Bubblegum state
    // while the Gambio AJAX update is still in progress.
    if (targetSelected && stableCount >= 4) return lastSnapshot;

    await page.waitForTimeout(500);
  }

  return lastSnapshot ?? (await readDomSnapshot(page));
}

export async function saveDiagnostics(page, outputDirectory, variantKey, networkRecords) {
  await ensureDirectory(outputDirectory);
  const base = safeFilename(variantKey);

  await page.screenshot({
    path: path.join(outputDirectory, `${base}.png`),
    fullPage: true
  });
  await fs.writeFile(
    path.join(outputDirectory, `${base}.html`),
    await page.content(),
    'utf8'
  );
  await fs.writeFile(
    path.join(outputDirectory, `${base}-network.json`),
    JSON.stringify(networkRecords, null, 2),
    'utf8'
  );
}
