import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, externalId, isAllowedLocation, verifyJob } from '../src/verify.js';

test('canonicalizes tracking URLs consistently', () => {
  assert.equal(canonicalizeUrl('https://EXAMPLE.com/job/1/?utm_source=x#apply'), 'https://example.com/job/1');
  assert.equal(externalId('https://example.com/job/1?source=x'), externalId('https://example.com/job/1'));
});

test('rejects non-target locations before fetching', async () => {
  const result = await verifyJob({ title: 'Salesforce Developer', location: 'London', url: 'https://example.com' }, () => { throw new Error('should not fetch'); });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'location');
});

test('accepts selected search regions', () => {
  assert.equal(isAllowedLocation({ location: 'Remote - United States' }), true);
  assert.equal(isAllowedLocation({ location: 'McLean, VA', remoteType: 'Hybrid' }), true);
  assert.equal(isAllowedLocation({ location: 'Bethesda, MD', remoteType: 'Onsite' }), true);
  assert.equal(isAllowedLocation({ location: 'Atlanta, GA', remoteType: 'Hybrid' }), true);
  assert.equal(isAllowedLocation({ location: 'Denver, CO', remoteType: 'Hybrid' }), false);
});

test('rejects closed postings', async () => {
  const result = await verifyJob({ title: 'Salesforce Administrator', location: 'Remote US', url: 'https://example.com/job' }, async () => ({ ok: true, status: 200, url: 'https://example.com/job', text: async () => 'This position has been filled.' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'closed');
});
