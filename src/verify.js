import { createHash } from 'node:crypto';

const closedPatterns = /job (?:is )?no longer available|position (?:has been )?filled|posting (?:has )?expired|applications are closed|404 not found/i;
const allowedTitle = /salesforce.*(?:administrator|admin|developer)|(?:administrator|admin|developer).*salesforce/i;
const remoteMarker = /remote|work from home/i;
const usMarker = /(?:^|\b)(?:us|u\.s\.|usa|united states|nationwide)(?:\b|$)/i;
const dmvMetro = /washington(?:,?\s*d\.?c\.?)?|district of columbia|northern virginia|arlington|alexandria|fairfax|falls church|mclean|tysons|reston|herndon|chantilly|leesburg|loudoun|bethesda|rockville|silver spring|gaithersburg|college park|greenbelt|hyattsville|prince george'?s|montgomery county|dmv/i;
const atlantaMetro = /atlanta|sandy springs|alpharetta|marietta|roswell|johns creek|dunwoody|brookhaven|decatur|smyrna|kennesaw|duluth|norcross|lawrenceville|peachtree corners|cobb county|fulton county|gwinnett county|dekalb county/i;
const aggregatorHosts = /(?:^|\.)(?:arc\.dev|builtin\.com|builtinnyc\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com|monster\.com|careerbuilder\.com|simplyhired\.com|talent\.com)$/i;
const collectionPaths = /\/(?:jobs?|careers?|openings?|search|remote-jobs)(?:\/)?$|\/remote-jobs\/salesforce\/?$|\/jobs\/remote\/.*salesforce\/?$/i;

export function isAllowedLocation(job) {
  const location = job.location || '';
  const remoteType = job.remoteType || '';
  const value = `${location} ${remoteType}`.trim();
  const allowedRemote = (remoteMarker.test(value) && usMarker.test(value)) ||
    (remoteMarker.test(remoteType) && (!location || remoteMarker.test(location)));
  return allowedRemote || dmvMetro.test(value) || atlantaMetro.test(value);
}

export function canonicalizeUrl(value) {
  const url = new URL(value);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'src'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '');
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

export async function verifyJob(job, fetchImpl = fetch, postedWithinDays = 3) {
  if (!job?.url || !allowedTitle.test(job.title || '')) return { ok: false, reason: 'title' };
  if (!isDirectPostingUrl(job.url)) return { ok: false, reason: 'collection-page' };
  if (!isAllowedLocation(job)) return { ok: false, reason: 'location' };
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
  return { ok: true, canonicalUrl: canonicalizeUrl(response.url || job.url), postedDate };
}
