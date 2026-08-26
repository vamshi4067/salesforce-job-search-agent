const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export function parseJsonResponse(text, schema) {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const open = schema?.type === 'array' ? '[' : '{';
    const close = schema?.type === 'array' ? ']' : '}';
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start < 0 || end <= start) throw new Error(`NVIDIA NIM returned invalid JSON: ${cleaned.slice(0, 160)}`);
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

async function request(config, prompt, maxTokens) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.nvidiaKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: config.nvidiaModel,
      messages: [
        { role: 'system', content: 'Follow the requested output format exactly. Do not include analysis, Markdown fences, or commentary.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      top_p: 0.7,
      max_tokens: maxTokens,
      stream: false
    })
  });
  if (!response.ok) throw new Error(`NVIDIA NIM request failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('NVIDIA NIM returned no text content');
  if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('NVIDIA NIM output was truncated.');
  return text;
}

async function generate(config, prompt, schema, maxTokens) {
  if (!schema) return request(config, prompt, maxTokens);
  const schemaPrompt = `${prompt}\n\nReturn only valid JSON matching this schema exactly:\n${JSON.stringify(schema)}`;
  const first = await request(config, schemaPrompt, maxTokens);
  try {
    return parseJsonResponse(first, schema);
  } catch {
    const repaired = await request(config, `Correct the malformed response below. Return only valid JSON matching this schema:\n${JSON.stringify(schema)}\n\nMALFORMED RESPONSE\n${first.slice(0, 30000)}`, maxTokens);
    return parseJsonResponse(repaired, schema);
  }
}

const jobSchema = {
  type: 'array', maxItems: 10,
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' },
      remoteType: { type: 'string' }, url: { type: 'string' }, postedDate: { type: ['string', 'null'] },
      salary: { type: ['string', 'null'] }, description: { type: 'string' }, source: { type: 'string' }
    },
    required: ['title', 'company', 'location', 'remoteType', 'url', 'postedDate', 'salary', 'description', 'source']
  }
};

export async function normalizeJobs(config, searchResults) {
  return generate(config, `Today is ${new Date().toISOString().slice(0, 10)}. Convert these search results into up to 10 unique Salesforce Administrator or Salesforce Developer job postings. Keep nationwide US remote roles, DC/DMV roles, and Atlanta metro roles. Preserve direct posting URLs. Do not invent facts; use an empty string or null when unknown.\n\nSEARCH RESULTS\n${JSON.stringify(searchResults).slice(0, 50000)}`, jobSchema, 4000);
}

const scoreSchema = {
  type: 'object',
  properties: {
    score: { type: 'integer' }, summary: { type: 'string' },
    matchedSkills: { type: 'array', items: { type: 'string' } },
    missingSkills: { type: 'array', items: { type: 'string' } },
    resumeType: { type: 'string' }
  },
  required: ['score', 'summary', 'matchedSkills', 'missingSkills', 'resumeType']
};

export async function scoreJob(config, job, resumeText) {
  const result = await generate(config, `Score this job against only facts in the resume. Never invent experience, certifications, metrics, employers, dates, or skills. Score from 0 to 100. resumeType must be Admin or Developer.\n\nJOB\n${JSON.stringify(job)}\n\nRESUME\n${resumeText.slice(0, 30000)}`, scoreSchema, 1000);
  result.score = Math.max(0, Math.min(100, Number(result.score) || 0));
  return result;
}

export async function tailorResume(config, job, resumeText) {
  return generate(config, `Rewrite the resume for this job. Preserve every fact and do not invent skills, employers, dates, certifications, metrics, education, or scope. Return clean Markdown only.\n\nJOB\n${JSON.stringify(job)}\n\nSOURCE RESUME\n${resumeText.slice(0, 30000)}`, null, 2500);
}
