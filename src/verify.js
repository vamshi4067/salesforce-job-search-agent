import { createHash } from 'node:crypto';

const closedPatterns = /job (?:is )?no longer available|position (?:has been )?filled|posting (?:has )?expired|applications are closed|404 not found/i;
const allowedTitle = /salesforce.*(?:administrator|admin|developer)|(?:administrator|admin|developer).*salesforce/i;
const usCountryMarker = /(?:^|\b)(?:us|u\.s\.|usa|united states|united states of america|nationwide)(?:\b|$)/i;
const usStateName = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;
const usStateCode = /(?:^|[\s,(/-])(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?=$|[\s,)/-])/;
const aggregatorHosts = /(?:^|\.)(?:arc\.dev|builtin\.com|builtinnyc\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com|monster\.com|careerbuilder\.com|simplyhired\.com|talent\.com)$/i;
const collectionPaths = /\/(?:jobs?|careers?|openings?|search|remote-jobs)(?:\/)?$|\/remote-jobs\/salesforce\/?$|\/jobs\/remote\/.*salesforce\/?$/i;

export function canonicalizeUrl(value) {
  const url = new URL(value);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'src'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '');
}

export function isUnitedStatesLocation(job) {
  const value = `${job?.location || ''} ${job?.remoteType || ''}`.trim();
  return usCountryMarker.test(value) || usStateName.test(value) || usStateCode.test(value);
}

export function isDirectPostingUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || aggregatorHosts.test(url.hostname)) return false;
    return !collectionPaths.test(url.pathname);
  } catch {
    return false;
  }
}

export function externalId(url) {
  return createHash('sha256').update(canonicalizeUrl(url)).digest('hex');
}

export function isRecentPostedDate(value, days = 3, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const posted = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(posted)) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((today - posted) / 86400000);
  return ageDays >= 0 && ageDays <= days;
}

export function extractPostedDate(body) {
  const patterns = [
    /["']datePosted["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,
    /(?:itemprop|name)=["']datePosted["'][^>]*content=["'](\d{4}-\d{2}-\d{2})/i,
    /content=["'](\d{4}-\d{2}-\d{2})[^"']*["'][^>]*(?:itemprop|name)=["']datePosted["']/i
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function classifySponsorship(body, aiValue = 'Unknown') {
  const text = body || '';
  const unavailable = /(?:will not|does not|do not|cannot|can't|unable to) (?:provide )?(?:visa |immigration )?sponsor|no (?:visa |immigration )?sponsorship|without (?:current or future )?(?:visa |immigration )?sponsorship|not (?:be )?eligible for (?:visa |immigration )?sponsorship/i;
  const available = /(?:visa|immigration) sponsorship (?:is )?(?:available|provided|offered)|(?:provide|offer) (?:visa|immigration) sponsorship|sponsor(?:ing|ship)? (?:for )?(?:h-?1b|employment visas?)/i;
  if (unavailable.test(text)) return 'Not Available';
  if (available.test(text)) return 'Available';
  return ['Available', 'Not Available'].includes(aiValue) ? aiValue : 'Unknown';
}

export async function verifyJob(job, fetchImpl = fetch, postedWithinDays = 3) {
  if (!job?.url || !allowedTitle.test(job.title || '')) return { ok: false, reason: 'title' };
  if (!isDirectPostingUrl(job.url)) return { ok: false, reason: 'collection-page' };
  if (!isUnitedStatesLocation(job)) return { ok: false, reason: 'non-us-location' };
  let response;
  try {
    response = await fetchImpl(job.url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 JobSearchVerifier/1.0' }, signal: AbortSignal.timeout(12000) });
  } catch { return { ok: false, reason: 'unreachable' }; }
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };
  const body = (await response.text()).slice(0, 250000);
  if (closedPatterns.test(body)) return { ok: false, reason: 'closed' };
  const postedDate = /^\d{4}-\d{2}-\d{2}$/.test(job.postedDate || '') ? job.postedDate : extractPostedDate(body);
  if (!postedDate) return { ok: false, reason: 'missing-posted-date' };
  if (!isRecentPostedDate(postedDate, postedWithinDays)) return { ok: false, reason: 'older-than-window' };
  return {
    ok: true,
    canonicalUrl: canonicalizeUrl(response.url || job.url),
    postedDate,
    sponsorship: classifySponsorship(body, job.sponsorship)
  };
}
