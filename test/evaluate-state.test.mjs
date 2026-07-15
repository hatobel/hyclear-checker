import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVariantState } from '../src/evaluate-state.mjs';
import { OUT_OF_STOCK_TEXT } from '../src/config.mjs';

const variant = {
  label: 'Orangensaft',
  value: '518',
  articleNumber: 'HyClear-Orange'
};

const base = {
  selectedValue: '518',
  selectedLabel: 'Orangensaft',
  articleNumber: 'HyClear-Orange',
  bannerExists: true,
  bannerVisible: false,
  bannerText: '',
  buttonExists: true,
  buttonDisabled: false,
  buttonClasses: ['btn', 'js-btn-add-to-cart']
};

test('returns available only for a validated variant with active cart button', () => {
  assert.equal(evaluateVariantState(base, variant).status, 'available');
});

test('returns unavailable for the exact visible stock banner', () => {
  const result = evaluateVariantState(
    { ...base, bannerVisible: true, bannerText: OUT_OF_STOCK_TEXT },
    variant
  );
  assert.equal(result.status, 'unavailable');
});

test('returns unavailable for disabled/inactive cart button', () => {
  assert.equal(
    evaluateVariantState({ ...base, buttonDisabled: true }, variant).status,
    'unavailable'
  );
  assert.equal(
    evaluateVariantState(
      { ...base, buttonClasses: [...base.buttonClasses, 'btn-inactive'] },
      variant
    ).status,
    'unavailable'
  );
});

test('fails closed when Bubblegum or the generic article number remains active', () => {
  assert.equal(
    evaluateVariantState(
      {
        ...base,
        selectedValue: '517',
        selectedLabel: 'Bubblegum',
        articleNumber: 'HyClear'
      },
      variant
    ).status,
    'unverifiable'
  );
});
