import { createHash } from 'node:crypto';

const closedPatterns = /job (?:is )?no longer available|position (?:has been )?filled|posting (?:has )?expired|applications are closed|404 not found/i;
const allowedTitle = /salesforce.*(?:administrator|admin|developer)|(?:administrator|admin|developer).*salesforce/i;
const remoteUs = /(?:remote|work from home).*(?:us|u\.s\.|usa|united states)|(?:us|u\.s\.|usa|united states).*(?:remote|work from home)|^remote$/i;
const dmvMetro = /washington(?:,?\s*d\.?c\.?)?|district of columbia|northern virginia|arlington|alexandria|fairfax|falls church|mclean|tysons|reston|herndon|chantilly|leesburg|loudoun|bethesda|rockville|silver spring|gaithersburg|college park|greenbelt|hyattsville|prince george'?s|montgomery county|dmv/i;
const atlantaMetro = /atlanta|sandy springs|alpharetta|marietta|roswell|johns creek|dunwoody|brookhaven|decatur|smyrna|kennesaw|duluth|norcross|lawrenceville|peachtree corners|cobb county|fulton county|gwinnett county|dekalb county/i;

export function isAllowedLocation(job) {
  const value = `${job.location || ''} ${job.remoteType || ''}`.trim();
  return remoteUs.test(value) || dmvMetro.test(value) || atlantaMetro.test(value);
}

export function canonicalizeUrl(value) {
  const url = new URL(value);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'src'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '');
}

export function externalId(url) {
  return createHash('sha256').update(canonicalizeUrl(url)).digest('hex');
}

export async function verifyJob(job, fetchImpl = fetch) {
  if (!job?.url || !allowedTitle.test(job.title || '')) return { ok: false, reason: 'title' };
  if (!isAllowedLocation(job)) return { ok: false, reason: 'location' };
  let response;
  try {
    response = await fetchImpl(job.url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 JobSearchVerifier/1.0' }, signal: AbortSignal.timeout(12000) });
  } catch { return { ok: false, reason: 'unreachable' }; }
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };
  const body = (await response.text()).slice(0, 250000);
  if (closedPatterns.test(body)) return { ok: false, reason: 'closed' };
  return { ok: true, canonicalUrl: canonicalizeUrl(response.url || job.url) };
}
