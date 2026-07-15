import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  readDomSnapshot,
  waitForStableVariantState
} from '../src/browser-helpers.mjs';
import { evaluateVariantState } from '../src/evaluate-state.mjs';
import { OUT_OF_STOCK_TEXT } from '../src/config.mjs';

const orange = {
  key: 'orange',
  label: 'Orangensaft',
  value: '518',
  articleNumber: 'HyClear-Orange'
};

const fastWait = {
  timeoutMs: 8_000,
  sampleIntervalMs: 100,
  stableSamples: 2,
  minimumWaitMs: 500,
  unavailableBannerGraceMs: 2_500
};

async function withBrowser(callback) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    return await callback(page);
  } finally {
    await browser.close();
  }
}

function mockPageHtml({ available }) {
  const update = available
    ? `
      model.textContent = '(Art.Nr.: HyClear-Orange)';
      banner.textContent = '';
      banner.style.display = 'none';
      button.disabled = false;
      button.className = 'btn btn-lg btn-buy btn-block js-btn-add-to-cart';
    `
    : `
      model.textContent = '(Art.Nr.: HyClear-Orange)';
      banner.textContent = ${JSON.stringify(OUT_OF_STOCK_TEXT)};
      banner.style.display = 'block';
      button.disabled = true;
      button.className = 'btn btn-lg btn-buy btn-block js-btn-add-to-cart inactive btn-inactive';
    `;

  return `<!doctype html>
    <html><body>
      <div id="model">(Art.Nr.: HyClear)</div>
      <select id="modifier_group_21">
        <option value="517" selected>Bubblegum</option>
        <option value="518">Orangensaft</option>
      </select>
      <div class="cart-error-msg alert alert-danger hidden" style="display:none"></div>
      <button name="btn-add-to-cart" class="btn js-btn-add-to-cart">In den Warenkorb</button>
      <script>
        const select = document.querySelector('#modifier_group_21');
        const model = document.querySelector('#model');
        const banner = document.querySelector('.cart-error-msg');
        const button = document.querySelector('button[name="btn-add-to-cart"]');
        select.addEventListener('change', () => {
          setTimeout(() => { ${update} }, 300);
        });
      </script>
    </body></html>`;
}

async function runMock(available) {
  return withBrowser(async page => {
    await page.setContent(mockPageHtml({ available }));
    await page.locator('#modifier_group_21').selectOption({ value: orange.value });
    const snapshot = await waitForStableVariantState(page, orange, fastWait);
    return { snapshot, result: evaluateVariantState(snapshot, orange) };
  });
}

test('waits for the AJAX-like update and detects unavailable', async () => {
  const { result } = await runMock(false);
  assert.equal(result.status, 'unavailable');
});

test('waits for the AJAX-like update and detects available', async () => {
  const { result } = await runMock(true);
  assert.equal(result.status, 'available');
});

test('reads the visible stock banner when an earlier duplicate banner is hidden and empty', async () => {
  await withBrowser(async page => {
    await page.setContent(`<!doctype html><html><body>
      <select id="modifier_group_21">
        <option value="518" selected>Orangensaft</option>
      </select>
      <div class="cart-error-msg alert alert-danger" style="display:none"></div>
      <div class="cart-error-msg alert alert-danger" style="display:block">${OUT_OF_STOCK_TEXT}</div>
      <button name="btn-add-to-cart" disabled class="btn inactive btn-inactive">In den Warenkorb</button>
    </body></html>`);

    const snapshot = await readDomSnapshot(page);
    assert.equal(snapshot.bannerCount, 2);
    assert.equal(snapshot.bannerVisible, true);
    assert.equal(snapshot.bannerText, OUT_OF_STOCK_TEXT);
    assert.deepEqual(snapshot.visibleBannerTexts, [OUT_OF_STOCK_TEXT]);
  });
});

test('does not stop at an early disabled button before a delayed banner is populated', async () => {
  await withBrowser(async page => {
    await page.setContent(`<!doctype html><html><body>
      <div>(Art.Nr.: HyClear)</div>
      <select id="modifier_group_21">
        <option value="517" selected>Bubblegum</option>
        <option value="518">Orangensaft</option>
      </select>
      <div class="cart-error-msg alert alert-danger" style="display:none"></div>
      <button name="btn-add-to-cart" class="btn">In den Warenkorb</button>
      <script>
        const select = document.querySelector('#modifier_group_21');
        const banner = document.querySelector('.cart-error-msg');
        const button = document.querySelector('button[name="btn-add-to-cart"]');
        select.addEventListener('change', () => {
          setTimeout(() => {
            button.disabled = true;
            button.className = 'btn inactive btn-inactive';
          }, 150);
          setTimeout(() => {
            banner.textContent = ${JSON.stringify(OUT_OF_STOCK_TEXT)};
            banner.style.display = 'block';
          }, 1_200);
        });
      </script>
    </body></html>`);

    await page.locator('#modifier_group_21').selectOption({ value: orange.value });
    const snapshot = await waitForStableVariantState(page, orange, fastWait);

    assert.equal(snapshot.bannerVisible, true);
    assert.equal(snapshot.bannerText, OUT_OF_STOCK_TEXT);
    assert.equal(snapshot.waitDiagnostics.exitReason, 'exact-out-of-stock-banner-stable');
  });
});

test('Bubblegum positive control must transition away and back before it is available', async () => {
  const bubblegum = {
    key: 'bubblegum-control',
    label: 'Bubblegum',
    value: '517',
    articleNumber: 'HyClear-Bubblegum',
    monitor: false,
    control: true
  };

  await withBrowser(async page => {
    await page.setContent(`<!doctype html><html><body>
      <div id="model">(Art.Nr.: HyClear)</div>
      <select id="modifier_group_21">
        <option value="517" selected>Bubblegum</option>
        <option value="518">Orangensaft</option>
      </select>
      <div class="cart-error-msg alert alert-danger" style="display:none"></div>
      <button name="btn-add-to-cart" class="btn">In den Warenkorb</button>
      <script>
        const select = document.querySelector('#modifier_group_21');
        const model = document.querySelector('#model');
        const banner = document.querySelector('.cart-error-msg');
        const button = document.querySelector('button[name="btn-add-to-cart"]');
        select.addEventListener('change', () => {
          setTimeout(() => {
            if (select.value === '518') {
              model.textContent = '(Art.Nr.: HyClear-Orange)';
              banner.textContent = ${JSON.stringify(OUT_OF_STOCK_TEXT)};
              banner.style.display = 'block';
              button.disabled = true;
              button.className = 'btn inactive btn-inactive';
            } else {
              model.textContent = '(Art.Nr.: HyClear-Bubblegum)';
              banner.textContent = '';
              banner.style.display = 'none';
              button.disabled = false;
              button.className = 'btn';
            }
          }, 250);
        });
      </script>
    </body></html>`);

    await page.locator('#modifier_group_21').selectOption('518');
    await waitForStableVariantState(page, orange, fastWait);
    await page.locator('#modifier_group_21').selectOption('517');
    const snapshot = await waitForStableVariantState(page, bubblegum, fastWait);
    const result = evaluateVariantState(snapshot, bubblegum);

    assert.equal(snapshot.selectedLabel, 'Bubblegum');
    assert.equal(result.status, 'available');
    assert.equal(bubblegum.monitor, false);
  });
});
