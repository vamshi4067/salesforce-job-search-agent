import { readFile } from 'node:fs/promises';

export async function authenticate(config) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.sfClientId, client_secret: config.sfClientSecret });
  const response = await fetch(`${config.sfLoginUrl}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error(`Salesforce authentication failed (${response.status})`);
  return response.json();
}

async function sfFetch(auth, path, options = {}) {
  const response = await fetch(`${auth.instance_url}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Salesforce request failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

export async function upsertJob(auth, job) {
  const id = encodeURIComponent(job.externalId);
  const result = await sfFetch(auth, `/services/data/v65.0/sobjects/Job_Application__c/Posting_Key__c/${id}`, { method: 'PATCH', body: JSON.stringify(job.fields) });
  if (result?.id) return result.id;
  const query = encodeURIComponent(`SELECT Id FROM Job_Application__c WHERE Posting_Key__c='${job.externalId}' LIMIT 1`);
  const found = await sfFetch(auth, `/services/data/v65.0/query?q=${query}`);
  return found.records[0].Id;
}

export async function attachFile(auth, recordId, filePath, title) {
  const bytes = await readFile(filePath);
  return sfFetch(auth, '/services/data/v65.0/sobjects/ContentVersion', {
    method: 'POST',
    body: JSON.stringify({ Title: title, PathOnClient: filePath.split('/').pop(), VersionData: bytes.toString('base64'), FirstPublishLocationId: recordId })
  });
}

export async function attachText(auth, recordId, content, title) {
  return sfFetch(auth, '/services/data/v65.0/sobjects/ContentVersion', {
    method: 'POST',
    body: JSON.stringify({ Title: title, PathOnClient: `${title}.md`, VersionData: Buffer.from(content).toString('base64'), FirstPublishLocationId: recordId })
  });
}

export async function sendSummary(auth, payload) {
  return sfFetch(auth, '/services/apexrest/job-search/v1/summary', { method: 'POST', body: JSON.stringify(payload) });
}
