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

test('returns available for a processed target variant with active cart button', () => {
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

test('accepts generic article number for a safe unavailable result', () => {
  const result = evaluateVariantState(
    {
      ...base,
      articleNumber: 'HyClear',
      buttonDisabled: true,
      buttonClasses: [...base.buttonClasses, 'inactive', 'btn-inactive']
    },
    variant
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.validation.articleNumberMatches, false);
  assert.equal(result.validation.variantIdentityValid, true);
});

test('does not report available with generic article number and no processing evidence', () => {
  const result = evaluateVariantState(
    { ...base, articleNumber: 'HyClear' },
    variant
  );

  assert.equal(result.status, 'unverifiable');
});

test('reports available with generic article number after successful variant response', () => {
  const result = evaluateVariantState(
    { ...base, articleNumber: 'HyClear' },
    variant,
    { successfulVariantResponseObserved: true }
  );

  assert.equal(result.status, 'available');
});

test('fails closed when Bubblegum remains selected', () => {
  assert.equal(
    evaluateVariantState(
      {
        ...base,
        selectedValue: '517',
        selectedLabel: 'Bubblegum',
        articleNumber: 'HyClear'
      },
      variant,
      { successfulVariantResponseObserved: true }
    ).status,
    'unverifiable'
  );
});

test('uses any exact visible banner text when duplicate banners exist', () => {
  const result = evaluateVariantState(
    {
      ...base,
      bannerVisible: true,
      bannerText: '',
      visibleBannerTexts: ['', OUT_OF_STOCK_TEXT]
    },
    variant
  );

  assert.equal(result.status, 'unavailable');
});
