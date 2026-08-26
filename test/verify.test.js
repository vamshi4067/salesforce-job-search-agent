import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, classifySponsorship, externalId, extractPostedDate, isDirectPostingUrl, isRecentPostedDate, isUnitedStatesLocation, verifyJob } from '../src/verify.js';

test('canonicalizes tracking URLs consistently', () => {
  assert.equal(canonicalizeUrl('https://EXAMPLE.com/job/1/?utm_source=x#apply'), 'https://example.com/job/1');
  assert.equal(externalId('https://example.com/job/1?source=x'), externalId('https://example.com/job/1'));
});

test('does not reject a posting because of its city or work arrangement', async () => {
  const result = await verifyJob(
    { title: 'Salesforce Developer', location: 'Denver, CO', remoteType: 'Onsite', url: 'https://example.com/job/123', postedDate: '2026-08-26' },
    async () => ({ ok: true, status: 200, url: 'https://example.com/job/123', text: async () => '<html>Apply now</html>' }),
    3
  );
  assert.equal(result.ok, true);
});

test('keeps only United States locations', () => {
  assert.equal(isUnitedStatesLocation({ location: 'Denver, CO', remoteType: 'Onsite' }), true);
  assert.equal(isUnitedStatesLocation({ location: 'New York, New York', remoteType: 'Hybrid' }), true);
  assert.equal(isUnitedStatesLocation({ location: 'Remote - United States', remoteType: 'Remote' }), true);
  assert.equal(isUnitedStatesLocation({ location: 'London, United Kingdom', remoteType: 'Hybrid' }), false);
  assert.equal(isUnitedStatesLocation({ location: 'Remote', remoteType: 'Remote' }), false);
});

test('rejects a non-US posting before fetching', async () => {
  const result = await verifyJob(
    { title: 'Salesforce Developer', location: 'London, United Kingdom', remoteType: 'Hybrid', url: 'https://example.com/job/456' },
    () => { throw new Error('should not fetch'); }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'non-us-location');
});

test('classifies explicit sponsorship language conservatively', () => {
  assert.equal(classifySponsorship('We are unable to provide visa sponsorship for this role.'), 'Not Available');
  assert.equal(classifySponsorship('H-1B visa sponsorship is available.'), 'Available');
  assert.equal(classifySponsorship('Equal opportunity employer.'), 'Unknown');
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
