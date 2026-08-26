import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { normalizeJobs, scoreJob, tailorResume } from './nvidia.js';
import { authenticate, attachFile, attachText, sendSummary, upsertJob } from './salesforce.js';
import { searchJobs } from './tavily.js';
import { externalId, verifyJob } from './verify.js';

async function loadResume() {
  return { text: await readFile('resumes/resume.txt', 'utf8'), pdf: 'resumes/resume.pdf' };
}

function isoDateOrNull(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

function sanitizeResume(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:contact|phone|email|address)\s*:/i.test(line))
    .join('\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, '[phone removed]');
}

async function main() {
  const config = loadConfig();
  const masterResume = await loadResume();
  const safeResumeText = sanitizeResume(masterResume.text);
  const searchResults = await searchJobs(config);
  console.log(`Tavily results: ${searchResults.length}`);
  const candidates = await normalizeJobs(config, searchResults);
  console.log(`AI candidates: ${candidates.length}`);
  const uniqueCandidates = [...new Map(candidates.map((job) => [job.url, job])).values()];
  if (uniqueCandidates.length !== candidates.length) {
    console.log(`Duplicate candidate URLs removed: ${candidates.length - uniqueCandidates.length}`);
  }
  const verified = [];
  const rejected = {};
  for (const candidate of uniqueCandidates) {
    const check = await verifyJob(candidate, undefined, config.postedWithinDays);
    if (check.ok) verified.push({ ...candidate, url: check.canonicalUrl, postedDate: check.postedDate, sponsorship: check.sponsorship });
    else rejected[check.reason] = (rejected[check.reason] || 0) + 1;
  }
  console.log(`Verified postings: ${verified.length}`);
  if (Object.keys(rejected).length) console.log(`Rejected postings: ${JSON.stringify(rejected)}`);
  const uniqueVerified = [...new Map(verified.map((job) => [externalId(job.url), job])).values()];
  if (uniqueVerified.length !== verified.length) {
    console.log(`Duplicate posting URLs removed: ${verified.length - uniqueVerified.length}`);
  }
  const ranked = [];
  for (const job of uniqueVerified) {
    const initialKind = /developer|apex|lwc/i.test(`${job.title} ${job.description}`) ? 'Developer' : 'Admin';
    const evaluation = await scoreJob(config, job, safeResumeText);
    evaluation.resumeType = initialKind;
    ranked.push({ ...job, evaluation, selected: masterResume });
  }
  ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
  const picks = ranked
    .filter((job) => job.evaluation.score >= config.minimumScore)
    .slice(0, config.maximumJobs);
  console.log(`Selected postings: ${picks.length} (minimum score ${config.minimumScore})`);
  console.log(JSON.stringify(picks.map(({ title, company, url, evaluation }) => ({ title, company, url, score: evaluation.score })), null, 2));
  if (config.dryRun) return;

  const auth = await authenticate(config);
  if (!picks.length) {
    const emptySummary = await sendSummary(auth, { email: config.summaryEmail, jobs: [] });
    console.log(`Summary email: ${emptySummary?.sent ? 'sent' : 'not sent'} (no new matches)`);
    return;
  }
  const newJobs = [];
  let refreshedCount = 0;
  for (const [index, job] of picks.entries()) {
    const upsert = await upsertJob(auth, {
      externalId: externalId(job.url),
      fields: {
        Name: `${job.title} - ${job.company}`.slice(0, 80), Company__c: job.company, Job_Title__c: job.title,
        Location__c: job.location, Remote_Type__c: job.remoteType, Posting_URL__c: job.url,
        Source__c: job.source, Posted_Date__c: isoDateOrNull(job.postedDate), Sponsorship__c: job.sponsorship || 'Unknown',
        Salary__c: job.salary || '', Description__c: (job.description || '').slice(0, 32000),
        Match_Score__c: job.evaluation.score, Match_Summary__c: job.evaluation.summary,
        Matched_Skills__c: job.evaluation.matchedSkills.join('; '), Missing_Skills__c: job.evaluation.missingSkills.join('; '),
        Resume_Type__c: job.evaluation.resumeType, Verified_Open__c: true, Last_Verified__c: new Date().toISOString()
      }
    });
    const recordId = upsert.id;
    if (upsert.created) newJobs.push(job);
    else refreshedCount += 1;
    await attachFile(auth, recordId, job.selected.pdf, 'Master Resume');
    if (index === 0 && upsert.created) {
      await attachText(auth, recordId, await tailorResume(config, job, safeResumeText), `Tailored Resume - ${job.company}`);
    }
  }
  console.log(`Salesforce records: ${newJobs.length} new, ${refreshedCount} refreshed`);
  const today = new Date().toISOString().slice(0, 10);
  const todaysJobs = newJobs.filter((job) => job.postedDate === today);
  const summary = await sendSummary(auth, { email: config.summaryEmail, jobs: todaysJobs.map((j) => ({ title: j.title, company: j.company, score: j.evaluation.score, url: j.url })) });
  console.log(`Summary email: ${summary?.sent ? 'sent' : 'not sent'} (${todaysJobs.length} jobs posted today)`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
