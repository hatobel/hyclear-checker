import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForStableVariantState } from '../src/browser-helpers.mjs';
import { evaluateVariantState } from '../src/evaluate-state.mjs';
import { OUT_OF_STOCK_TEXT } from '../src/config.mjs';

const variant = {
  key: 'orange',
  label: 'Orangensaft',
  value: '518',
  articleNumber: 'HyClear-Orange'
};

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
          setTimeout(() => { ${update} }, 700);
        });
      </script>
    </body></html>`;
}

async function runMock(available) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  try {
    const page = await browser.newPage();
    await page.setContent(mockPageHtml({ available }));
    await page.locator('#modifier_group_21').selectOption({ value: variant.value });
    const snapshot = await waitForStableVariantState(page, variant, 10_000);
    return evaluateVariantState(snapshot, variant);
  } finally {
    await browser.close();
  }
}

test('waits for the AJAX-like update and detects unavailable', async () => {
  const result = await runMock(false);
  assert.equal(result.status, 'unavailable');
});

test('waits for the AJAX-like update and detects available', async () => {
  const result = await runMock(true);
  assert.equal(result.status, 'available');
});
