import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BANNER_SELECTOR,
  CART_BUTTON_SELECTOR,
  OUT_OF_STOCK_TEXT,
  SELECTOR
} from './config.mjs';

const SHOP_ORIGIN = 'https://www.ruehl24.de/';

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

function isRelevantShopRequest(request) {
  return (
    ['xhr', 'fetch'].includes(request.resourceType()) &&
    request.url().startsWith(SHOP_ORIGIN)
  );
}

/**
 * Tracks same-origin XHR/fetch traffic that starts after this function is called.
 * The tracker is registered before selectOption(), so a fast Gambio request cannot
 * slip through between the selection and the wait call.
 */
export function startRelevantNetworkTracker(page) {
  const inFlight = new Set();
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let observedRequests = 0;
  let finishedRequests = 0;
  let failedRequests = 0;

  const onRequest = request => {
    if (!isRelevantShopRequest(request)) return;
    inFlight.add(request);
    observedRequests += 1;
    lastActivityAt = Date.now();
  };

  const onRequestFinished = request => {
    if (!isRelevantShopRequest(request)) return;
    inFlight.delete(request);
    finishedRequests += 1;
    lastActivityAt = Date.now();
  };

  const onRequestFailed = request => {
    if (!isRelevantShopRequest(request)) return;
    inFlight.delete(request);
    failedRequests += 1;
    lastActivityAt = Date.now();
  };

  page.on('request', onRequest);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);

  const summary = (timedOut = false) => ({
    observedRequests,
    finishedRequests,
    failedRequests,
    inFlightRequests: inFlight.size,
    quietForMs: Date.now() - lastActivityAt,
    elapsedMs: Date.now() - startedAt,
    timedOut
  });

  return {
    async waitForQuiet({ idleMs = 1_500, timeoutMs = 15_000 } = {}) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (inFlight.size === 0 && Date.now() - lastActivityAt >= idleMs) {
          return summary(false);
        }
        await page.waitForTimeout(100);
      }

      return summary(true);
    },

    stop() {
      page.off('request', onRequest);
      page.off('requestfinished', onRequestFinished);
      page.off('requestfailed', onRequestFailed);
      return summary(false);
    }
  };
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

export async function readDomSnapshot(page) {
  return page.evaluate(
    ({ selectSelector, bannerSelector, buttonSelector }) => {
      const isVisible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return Boolean(
          style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            !element.hidden &&
            element.getAttribute('aria-hidden') !== 'true' &&
            (element.getClientRects().length > 0 || style.position === 'fixed')
        );
      };

      const select = document.querySelector(selectSelector);
      const selectedOption = select?.selectedOptions?.[0] ?? null;
      const bodyText = document.body?.innerText ?? '';
      const articleMatch = bodyText.match(/\(Art\.Nr\.:\s*([^\)\n]+)\)/i);

      // Rühl24 can render duplicate desktop/mobile alert containers. Reading only
      // querySelector() may therefore return a hidden, empty alert while another
      // matching alert contains the actual stock message.
      const banners = [...document.querySelectorAll(bannerSelector)].map(
        (banner, index) => ({
          index,
          visible: isVisible(banner),
          text: banner.textContent?.trim() ?? '',
          classes: [...banner.classList],
          inlineStyle: banner.getAttribute('style') ?? '',
          hiddenAttribute: banner.hasAttribute('hidden'),
          ariaHidden: banner.getAttribute('aria-hidden')
        })
      );
      const visibleBanners = banners.filter(banner => banner.visible);
      const visibleBannerTexts = visibleBanners
        .map(banner => banner.text)
        .filter(Boolean);
      const representativeBanner =
        visibleBanners.find(banner => banner.text) ??
        visibleBanners[0] ??
        banners.find(banner => banner.text) ??
        banners[0] ??
        null;

      // Use the visible cart button when responsive markup contains duplicates.
      const buttons = [...document.querySelectorAll(buttonSelector)].map(
        (button, index) => ({
          index,
          visible: isVisible(button),
          disabled: Boolean(button.disabled || button.hasAttribute('disabled')),
          classes: [...button.classList],
          title: button.getAttribute('title') ?? null,
          text: button.textContent?.trim() ?? ''
        })
      );
      const representativeButton =
        buttons.find(button => button.visible) ?? buttons[0] ?? null;

      return {
        selectedValue: select?.value ?? null,
        selectedLabel: selectedOption?.textContent?.trim() ?? null,
        articleNumber: articleMatch?.[1]?.trim() ?? null,

        bannerExists: banners.length > 0,
        bannerCount: banners.length,
        bannerVisible: visibleBanners.length > 0,
        bannerText: representativeBanner?.text ?? '',
        visibleBannerTexts,
        banners,

        buttonExists: buttons.length > 0,
        buttonCount: buttons.length,
        buttonVisible: representativeButton?.visible ?? false,
        buttonDisabled: representativeButton?.disabled ?? false,
        buttonClasses: representativeButton?.classes ?? [],
        buttonTitle: representativeButton?.title ?? null,
        buttons,

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

function normalizeWaitOptions(options) {
  if (typeof options === 'number') {
    return { timeoutMs: options };
  }
  return options ?? {};
}

export async function waitForStableVariantState(page, variant, options = {}) {
  const {
    timeoutMs = 30_000,
    sampleIntervalMs = 500,
    stableSamples = 5,
    minimumWaitMs = 4_000,
    unavailableBannerGraceMs = 8_000
  } = normalizeWaitOptions(options);

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let targetSelectedAt = null;
  let previous = null;
  let stableCount = 0;
  let sampleCount = 0;
  let lastSnapshot = null;
  const transitions = [];

  while (Date.now() < deadline) {
    lastSnapshot = await readDomSnapshot(page);
    sampleCount += 1;

    const signature = JSON.stringify({
      selectedValue: lastSnapshot.selectedValue,
      selectedLabel: lastSnapshot.selectedLabel,
      articleNumber: lastSnapshot.articleNumber,
      bannerVisible: lastSnapshot.bannerVisible,
      bannerText: lastSnapshot.bannerText,
      visibleBannerTexts: lastSnapshot.visibleBannerTexts,
      banners: lastSnapshot.banners,
      buttonVisible: lastSnapshot.buttonVisible,
      buttonDisabled: lastSnapshot.buttonDisabled,
      buttonClasses: lastSnapshot.buttonClasses,
      buttons: lastSnapshot.buttons
    });

    if (signature === previous) {
      stableCount += 1;
    } else {
      previous = signature;
      stableCount = 0;
      if (transitions.length < 30) {
        transitions.push({
          elapsedMs: Date.now() - startedAt,
          selectedValue: lastSnapshot.selectedValue,
          selectedLabel: lastSnapshot.selectedLabel,
          bannerVisible: lastSnapshot.bannerVisible,
          bannerText: lastSnapshot.bannerText,
          visibleBannerTexts: lastSnapshot.visibleBannerTexts,
          buttonVisible: lastSnapshot.buttonVisible,
          buttonDisabled: lastSnapshot.buttonDisabled,
          buttonClasses: lastSnapshot.buttonClasses
        });
      }
    }

    const targetSelected =
      lastSnapshot.selectedValue === variant.value &&
      lastSnapshot.selectedLabel === variant.label;

    if (targetSelected && targetSelectedAt === null) {
      targetSelectedAt = Date.now();
    }

    const elapsedSinceTarget =
      targetSelectedAt === null ? 0 : Date.now() - targetSelectedAt;
    const exactVisibleBanner =
      lastSnapshot.bannerVisible &&
      (lastSnapshot.visibleBannerTexts?.includes(OUT_OF_STOCK_TEXT) ||
        lastSnapshot.bannerText === OUT_OF_STOCK_TEXT);
    const inactiveButton =
      lastSnapshot.buttonDisabled ||
      lastSnapshot.buttonClasses.includes('inactive') ||
      lastSnapshot.buttonClasses.includes('btn-inactive');

    // The first live run showed the button had already become inactive while the
    // selected alert snapshot was still empty. Give the alert a longer grace
    // period before accepting the final state. A negative result remains valid
    // from the button alone if Rühl24 never populates an alert in headless mode.
    const awaitingDelayedBanner =
      targetSelected &&
      inactiveButton &&
      !exactVisibleBanner &&
      elapsedSinceTarget < unavailableBannerGraceMs;

    const minimumObservationComplete = elapsedSinceTarget >= minimumWaitMs;
    const stableLongEnough = stableCount >= stableSamples;

    if (
      targetSelected &&
      minimumObservationComplete &&
      stableLongEnough &&
      !awaitingDelayedBanner
    ) {
      return {
        ...lastSnapshot,
        waitDiagnostics: {
          exitReason: exactVisibleBanner
            ? 'exact-out-of-stock-banner-stable'
            : inactiveButton
              ? 'inactive-button-stable-after-banner-grace'
              : 'active-state-stable',
          elapsedMs: Date.now() - startedAt,
          elapsedSinceTargetMs: elapsedSinceTarget,
          sampleCount,
          stableCount,
          minimumWaitMs,
          unavailableBannerGraceMs,
          transitions
        }
      };
    }

    await page.waitForTimeout(sampleIntervalMs);
  }

  const snapshot = lastSnapshot ?? (await readDomSnapshot(page));
  return {
    ...snapshot,
    waitDiagnostics: {
      exitReason: 'timeout',
      elapsedMs: Date.now() - startedAt,
      elapsedSinceTargetMs:
        targetSelectedAt === null ? null : Date.now() - targetSelectedAt,
      sampleCount,
      stableCount,
      minimumWaitMs,
      unavailableBannerGraceMs,
      transitions
    }
  };
}

export async function startVariantProcessingProbe(page) {
  await page.evaluate(
    ({ bannerSelector, buttonSelector }) => {
      const targets = [
        ...document.querySelectorAll(bannerSelector),
        ...document.querySelectorAll(buttonSelector)
      ];
      for (const element of [...targets]) {
        if (element.parentElement) targets.push(element.parentElement);
      }

      const state = {
        mutationCount: 0,
        mutations: []
      };

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          state.mutationCount += 1;
          if (state.mutations.length < 100) {
            state.mutations.push({
              type: mutation.type,
              attributeName: mutation.attributeName ?? null,
              targetTag: mutation.target?.tagName ?? null,
              targetClass: mutation.target?.className ?? null
            });
          }
        }
      });

      for (const target of new Set(targets.filter(Boolean))) {
        observer.observe(target, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true
        });
      }

      window.__hyclearVariantProbe = { state, observer };
    },
    {
      bannerSelector: BANNER_SELECTOR,
      buttonSelector: CART_BUTTON_SELECTOR
    }
  );
}

export async function stopVariantProcessingProbe(page) {
  return page.evaluate(() => {
    const probe = window.__hyclearVariantProbe;
    if (!probe) {
      return { mutationCount: 0, mutations: [] };
    }

    probe.observer.disconnect();
    const result = probe.state;
    delete window.__hyclearVariantProbe;
    return result;
  });
}

export function buildVariantProcessingEvidence(
  networkRecords,
  startIndex,
  variant,
  domProbe,
  networkWait = null
) {
  const records = networkRecords.slice(startIndex);
  const plainField = `modifiers[property][21]=${variant.value}`;
  const encodedField = `modifiers%5Bproperty%5D%5B21%5D=${variant.value}`;

  const requestMatches = record => {
    if (record.phase !== 'request' || !record.url.startsWith(SHOP_ORIGIN)) {
      return false;
    }
    const haystack = `${record.url}\n${record.postData ?? ''}`;
    return (
      haystack.includes(plainField) ||
      haystack.includes(encodedField) ||
      haystack.includes(variant.articleNumber) ||
      haystack.includes(variant.label) ||
      (haystack.includes(variant.value) &&
        /(modifier|property|combination|calculate|product)/i.test(haystack))
    );
  };

  const variantRequests = records.filter(requestMatches);
  const successfulVariantResponses = records.filter(record => {
    if (record.phase !== 'response') return false;
    if (!record.url.startsWith(SHOP_ORIGIN)) return false;
    if (record.status < 200 || record.status >= 400) return false;

    const matchingRequest = variantRequests.some(
      request => request.url === record.url && request.method === record.method
    );
    if (matchingRequest) return true;

    const body = record.bodyPreview ?? '';
    return (
      body.includes(variant.articleNumber) ||
      body.includes(variant.label) ||
      body.includes(plainField) ||
      body.includes(encodedField)
    );
  });

  return {
    networkRecordsAfterSelection: records.length,
    variantRequestObserved: variantRequests.length > 0,
    successfulVariantResponseObserved: successfulVariantResponses.length > 0,
    relevantDomMutationObserved: (domProbe?.mutationCount ?? 0) > 0,
    domMutationCount: domProbe?.mutationCount ?? 0,
    networkWait,
    matchedRequestUrls: [...new Set(variantRequests.map(record => record.url))],
    matchedResponseUrls: [
      ...new Set(successfulVariantResponses.map(record => record.url))
    ]
  };
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
