import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, externalId, extractPostedDate, isAllowedLocation, isDirectPostingUrl, isRecentPostedDate, verifyJob } from '../src/verify.js';

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
  assert.equal(isAllowedLocation({ location: 'Remote', remoteType: 'Remote' }), true);
  assert.equal(isAllowedLocation({ location: 'Remote - United States' }), true);
  assert.equal(isAllowedLocation({ location: 'McLean, VA', remoteType: 'Hybrid' }), true);
  assert.equal(isAllowedLocation({ location: 'Bethesda, MD', remoteType: 'Onsite' }), true);
  assert.equal(isAllowedLocation({ location: 'Atlanta, GA', remoteType: 'Hybrid' }), true);
  assert.equal(isAllowedLocation({ location: 'Denver, CO', remoteType: 'Hybrid' }), false);
});

test('accepts direct ATS links and rejects collection pages', () => {
  assert.equal(isDirectPostingUrl('https://jobs.lever.co/example/1234'), true);
  assert.equal(isDirectPostingUrl('https://boards.greenhouse.io/example/jobs/1234'), true);
  assert.equal(isDirectPostingUrl('https://arc.dev/remote-jobs/salesforce'), false);
  assert.equal(isDirectPostingUrl('https://example.com/careers'), false);
});

test('extracts and validates recent posting dates', () => {
  assert.equal(extractPostedDate('<script>{"datePosted":"2026-08-25T10:00:00Z"}</script>'), '2026-08-25');
  assert.equal(isRecentPostedDate('2026-08-23', 3, new Date('2026-08-26T12:00:00Z')), true);
  assert.equal(isRecentPostedDate('2026-08-22', 3, new Date('2026-08-26T12:00:00Z')), false);
  assert.equal(isRecentPostedDate(null, 3, new Date('2026-08-26T12:00:00Z')), false);
});

test('rejects closed postings', async () => {
  const result = await verifyJob({ title: 'Salesforce Administrator', location: 'Remote US', url: 'https://example.com/job/123' }, async () => ({ ok: true, status: 200, url: 'https://example.com/job/123', text: async () => 'This position has been filled.' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'closed');
});
