import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PRODUCT_URL, SELECTOR, VARIANTS } from '../src/config.mjs';
import { evaluateVariantState } from '../src/evaluate-state.mjs';
import {
  attachNetworkRecorder,
  dismissCommonCookieDialogs,
  ensureDirectory,
  saveDiagnostics,
  waitForStableVariantState,
  startRelevantNetworkTracker,
  startVariantProcessingProbe,
  stopVariantProcessingProbe,
  buildVariantProcessingEvidence
} from '../src/browser-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const artifactDirectory = path.join(root, 'artifacts');
const statusDirectory = path.join(root, 'status');
const previousStatePath = path.join(statusDirectory, 'last-known.json');
const latestPath = path.join(statusDirectory, 'latest.json');
const notificationPath = path.join(statusDirectory, 'notification.md');

await ensureDirectory(artifactDirectory);
await ensureDirectory(statusDirectory);

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const variant of VARIANTS) {
    const context = await browser.newContext({
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    const networkRecords = await attachNetworkRecorder(page);

    try {
      await page.goto(PRODUCT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
      await dismissCommonCookieDialogs(page);

      const dropdown = page.locator(SELECTOR);
      await dropdown.waitFor({ state: 'visible', timeout: 30_000 });

      const optionExists = await dropdown
        .locator(`option[value="${variant.value}"]`)
        .count();
      if (optionExists !== 1) {
        throw new Error(
          `Dropdown option ${variant.value} (${variant.label}) was not found exactly once.`
        );
      }

      // Bubblegum is the initial page selection. For the positive control,
      // deliberately switch to another option first and then back to Bubblegum.
      // This verifies the full Gambio update path instead of accepting the initial
      // active cart button as proof.
      if (variant.preselectValue) {
        const preselectionTracker = startRelevantNetworkTracker(page);
        try {
          await dropdown.selectOption({ value: variant.preselectValue });
          await page.waitForFunction(
            ({ selector, value }) => document.querySelector(selector)?.value === value,
            { selector: SELECTOR, value: variant.preselectValue },
            { timeout: 10_000 }
          );
          await preselectionTracker.waitForQuiet({
            idleMs: 1_500,
            timeoutMs: 15_000
          });
          await page.waitForTimeout(1_500);
        } finally {
          preselectionTracker.stop();
        }
      }

      const networkStartIndex = networkRecords.length;
      const targetNetworkTracker = startRelevantNetworkTracker(page);
      await startVariantProcessingProbe(page);

      let networkWait = null;
      try {
        await dropdown.selectOption({ value: variant.value });
        await page.waitForFunction(
          ({ selector, value }) => document.querySelector(selector)?.value === value,
          { selector: SELECTOR, value: variant.value },
          { timeout: 10_000 }
        );

        networkWait = await targetNetworkTracker.waitForQuiet({
          idleMs: 1_500,
          timeoutMs: 15_000
        });
      } finally {
        targetNetworkTracker.stop();
      }

      const snapshot = await waitForStableVariantState(page, variant);
      const domProbe = await stopVariantProcessingProbe(page);
      const processingEvidence = buildVariantProcessingEvidence(
        networkRecords,
        networkStartIndex,
        variant,
        domProbe,
        networkWait
      );
      const evaluation = evaluateVariantState(
        snapshot,
        variant,
        processingEvidence
      );

      results.push({
        checkedAt: new Date().toISOString(),
        variant,
        snapshot,
        ...evaluation
      });
    } catch (error) {
      results.push({
        checkedAt: new Date().toISOString(),
        variant,
        status: 'unverifiable',
        reason: error instanceof Error ? error.message : String(error),
        validation: { valid: false }
      });
    } finally {
      await saveDiagnostics(page, artifactDirectory, variant.key, networkRecords);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

let previousState = { variants: {} };
try {
  previousState = JSON.parse(await fs.readFile(previousStatePath, 'utf8'));
} catch {
  // First run: unavailable products establish a silent baseline.
}

const changes = [];
const nextKnown = { ...previousState.variants };

for (const result of results) {
  // Positive controls are written to latest.json and the workflow summary, but
  // never influence persisted target state, changes or notifications.
  if (result.variant.monitor === false) continue;

  const previous = previousState.variants?.[result.variant.key] ?? null;
  if (result.status === 'available' || result.status === 'unavailable') {
    nextKnown[result.variant.key] = {
      status: result.status,
      checkedAt: result.checkedAt,
      label: result.variant.label,
      articleNumber: result.variant.articleNumber
    };

    if (previous && previous.status !== result.status) {
      changes.push({
        label: result.variant.label,
        articleNumber: result.variant.articleNumber,
        before: previous.status,
        after: result.status
      });
    }
  }
}

const available = results.filter(
  result => result.variant.monitor !== false && result.status === 'available'
);
const shouldNotify = available.length > 0 || changes.length > 0;
const latest = {
  generatedAt: new Date().toISOString(),
  productUrl: PRODUCT_URL,
  shouldNotify,
  changes,
  controls: results
    .filter(result => result.variant.control)
    .map(result => ({
      key: result.variant.key,
      label: result.variant.label,
      status: result.status,
      checkedAt: result.checkedAt,
      excludedFromNotifications: true
    })),
  variants: results
};

await fs.writeFile(latestPath, JSON.stringify(latest, null, 2), 'utf8');
await fs.writeFile(
  previousStatePath,
  JSON.stringify({ updatedAt: latest.generatedAt, variants: nextKnown }, null, 2),
  'utf8'
);

const statusLabel = {
  available: 'VERFÜGBAR',
  unavailable: 'NICHT VERFÜGBAR',
  unverifiable: 'NICHT VERIFIZIERBAR'
};

const notificationLines = [
  '# HyClear-Verfügbarkeitsprüfung',
  '',
  `Prüfzeit: ${latest.generatedAt}`,
  '',
  ...results.map(result => {
    const controlLabel = result.variant.control
      ? ' — Kontrollvariante, von Benachrichtigungen ausgeschlossen'
      : '';
    return (
      `- **${result.variant.label}** — \`${result.variant.articleNumber}\` — ` +
      `**${statusLabel[result.status]}**${controlLabel} — ${result.reason}`
    );
  })
];

if (changes.length > 0) {
  notificationLines.push('', '## Statusänderungen');
  for (const change of changes) {
    notificationLines.push(
      `- ${change.label}: ${statusLabel[change.before]} → ${statusLabel[change.after]}`
    );
  }
}

await fs.writeFile(notificationPath, `${notificationLines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify(latest, null, 2));
