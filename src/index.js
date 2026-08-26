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
  const diagnosticBypass = config.bypassJobFilters;
  const candidates = diagnosticBypass
    ? searchResults.slice(0, config.maximumJobs).map((result) => {
        let source = 'Tavily';
        try { source = new URL(result.url).hostname.replace(/^www\./, ''); } catch { /* rejected below */ }
        const titleParts = (result.title || 'Salesforce Job').split(/\s+[|–—-]\s+/);
        return {
          title: (result.title || 'Salesforce Job').slice(0, 255),
          company: (titleParts.at(-1) || source).slice(0, 255),
          location: 'Unverified search result',
          remoteType: 'Unverified',
          url: result.url,
          postedDate: null,
          salary: null,
          description: result.content || result.title || '',
          source
        };
      })
    : await normalizeJobs(config, searchResults);
  console.log(`AI candidates: ${candidates.length}`);
  const verified = [];
  const rejected = {};
  for (const candidate of candidates) {
    if (diagnosticBypass) {
      try {
        verified.push({ ...candidate, url: new URL(candidate.url).toString() });
      } catch {
        rejected['invalid-url'] = (rejected['invalid-url'] || 0) + 1;
      }
      continue;
    }
    const check = await verifyJob(candidate);
    if (check.ok) verified.push({ ...candidate, url: check.canonicalUrl });
    else rejected[check.reason] = (rejected[check.reason] || 0) + 1;
  }
  console.log(`Verified postings: ${verified.length}`);
  if (Object.keys(rejected).length) console.log(`Rejected postings: ${JSON.stringify(rejected)}`);
  const ranked = [];
  for (const job of verified) {
    const initialKind = /developer|apex|lwc/i.test(`${job.title} ${job.description}`) ? 'Developer' : 'Admin';
    const evaluation = diagnosticBypass
      ? {
          score: 0,
          summary: 'Diagnostic record created with filters and AI scoring bypassed.',
          matchedSkills: [],
          missingSkills: [],
          resumeType: initialKind
        }
      : await scoreJob(config, job, safeResumeText);
    evaluation.resumeType = initialKind;
    ranked.push({ ...job, evaluation, selected: masterResume });
  }
  ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
  const picks = ranked
    .filter((job) => diagnosticBypass || job.evaluation.score >= config.minimumScore)
    .slice(0, config.maximumJobs);
  console.log(`Selected postings: ${picks.length} (${diagnosticBypass ? 'filters bypassed' : `minimum score ${config.minimumScore}`})`);
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
    if (index === 0 && !diagnosticBypass) {
      await attachText(auth, recordId, await tailorResume(config, job, safeResumeText), `Tailored Resume - ${job.company}`);
    }
  }
  await sendSummary(auth, { email: config.summaryEmail, jobs: picks.map((j) => ({ title: j.title, company: j.company, score: j.evaluation.score, url: j.url })) });
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
