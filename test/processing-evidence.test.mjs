import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVariantProcessingEvidence } from '../src/browser-helpers.mjs';

const variant = {
  label: 'Orangensaft',
  value: '518',
  articleNumber: 'HyClear-Orange'
};

test('detects a successful same-origin variant request', () => {
  const records = [
    {
      phase: 'request',
      method: 'POST',
      url: 'https://www.ruehl24.de/request_port.php',
      postData: 'modifiers%5Bproperty%5D%5B21%5D=518',
      resourceType: 'xhr'
    },
    {
      phase: 'response',
      method: 'POST',
      url: 'https://www.ruehl24.de/request_port.php',
      status: 200,
      bodyPreview: '{}',
      resourceType: 'xhr'
    }
  ];

  const evidence = buildVariantProcessingEvidence(records, 0, variant, {
    mutationCount: 0
  });

  assert.equal(evidence.variantRequestObserved, true);
  assert.equal(evidence.successfulVariantResponseObserved, true);
});

test('ignores unrelated third-party requests', () => {
  const records = [
    {
      phase: 'request',
      method: 'POST',
      url: 'https://analytics.example/collect',
      postData: '518',
      resourceType: 'fetch'
    },
    {
      phase: 'response',
      method: 'POST',
      url: 'https://analytics.example/collect',
      status: 204,
      bodyPreview: null,
      resourceType: 'fetch'
    }
  ];

  const evidence = buildVariantProcessingEvidence(records, 0, variant, {
    mutationCount: 0
  });

  assert.equal(evidence.variantRequestObserved, false);
  assert.equal(evidence.successfulVariantResponseObserved, false);
});
