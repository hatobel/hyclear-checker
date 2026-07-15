import test from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS } from '../src/config.mjs';

test('Bubblegum is present as a non-notifying positive control', () => {
  const control = VARIANTS.find(variant => variant.key === 'bubblegum-control');
  assert.ok(control);
  assert.equal(control.value, '517');
  assert.equal(control.label, 'Bubblegum');
  assert.equal(control.control, true);
  assert.equal(control.monitor, false);
  assert.equal(control.preselectValue, '518');
});
