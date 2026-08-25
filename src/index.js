import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { normalizeJobs, scoreJob, tailorResume } from './gemini.js';
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
  const candidates = await normalizeJobs(config, await searchJobs(config));
  const verified = [];
  for (const candidate of candidates) {
    const check = await verifyJob(candidate);
    if (check.ok) verified.push({ ...candidate, url: check.canonicalUrl });
  }
  const ranked = [];
  for (const job of verified) {
    const initialKind = /developer|apex|lwc/i.test(`${job.title} ${job.description}`) ? 'Developer' : 'Admin';
    const evaluation = await scoreJob(config, job, safeResumeText);
    evaluation.resumeType = initialKind;
    ranked.push({ ...job, evaluation, selected: masterResume });
  }
  ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
  const picks = ranked.filter((job) => job.evaluation.score >= config.minimumScore).slice(0, config.maximumJobs);
  console.log(JSON.stringify(picks.map(({ title, company, url, evaluation }) => ({ title, company, url, score: evaluation.score })), null, 2));
  if (config.dryRun || !picks.length) return;

  const auth = await authenticate(config);
  for (const [index, job] of picks.entries()) {
    const recordId = await upsertJob(auth, {
      externalId: externalId(job.url),
      fields: {
        Name: `${job.title} - ${job.company}`.slice(0, 80), Company__c: job.company, Job_Title__c: job.title,
        Location__c: job.location, Remote_Type__c: job.remoteType, Posting_URL__c: job.url,
        Posting_Key__c: externalId(job.url), Source__c: job.source, Posted_Date__c: isoDateOrNull(job.postedDate),
        Salary__c: job.salary || '', Description__c: (job.description || '').slice(0, 32000),
        Match_Score__c: job.evaluation.score, Match_Summary__c: job.evaluation.summary,
        Matched_Skills__c: job.evaluation.matchedSkills.join('; '), Missing_Skills__c: job.evaluation.missingSkills.join('; '),
        Resume_Type__c: job.evaluation.resumeType, Status__c: 'Discovered', Verified_Open__c: true, Last_Verified__c: new Date().toISOString()
      }
    });
    await attachFile(auth, recordId, job.selected.pdf, 'Master Resume');
    if (index === 0) await attachText(auth, recordId, await tailorResume(config, job, safeResumeText), `Tailored Resume - ${job.company}`);
  }
  await sendSummary(auth, { email: config.summaryEmail, jobs: picks.map((j) => ({ title: j.title, company: j.company, score: j.evaluation.score, url: j.url })) });
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
