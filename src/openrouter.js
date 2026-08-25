const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function request(config, body) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/private/salesforce-job-search-agent',
      'X-Title': 'Salesforce Job Search Agent'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}): ${await response.text()}`);
  return response.json();
}

function parseJsonContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Model returned no text content');
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

export async function discoverJobs(config) {
  const today = new Date().toISOString().slice(0, 10);
  const data = await request(config, {
    model: config.model,
    temperature: 0,
    tools: [{
      type: 'openrouter:web_search',
      parameters: {
        engine: 'auto', max_results: 10, max_total_results: 30, max_uses: 6,
        excluded_domains: ['linkedin.com', 'indeed.com', 'glassdoor.com']
      }
    }],
    max_tool_calls: 8,
    messages: [{ role: 'user', content: `Today is ${today}. Search employer career sites and reputable ATS pages for currently open US roles with these titles: Salesforce Administrator, Senior Salesforce Administrator, Salesforce Developer, Senior Salesforce Developer. Location must be one of: remote anywhere in the United States; Washington DC/DMV metro (DC, Northern Virginia, or nearby Maryland); or Atlanta, Georgia metro. Reject onsite or hybrid roles outside those metros. Exclude contract-only roles unless explicitly contract-to-hire. Return ONLY a JSON array with at most 30 objects using keys: title, company, location, remoteType, url, postedDate, salary, description, source. Use the direct employer or ATS posting URL. Do not include uncertain or closed roles.` }]
  });
  const jobs = parseJsonContent(data);
  if (!Array.isArray(jobs)) throw new Error('Search response was not an array');
  return jobs;
}

export async function scoreJob(config, job, resumeText) {
  const data = await request(config, {
    model: config.model,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'job_score', strict: true,
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            summary: { type: 'string' },
            matchedSkills: { type: 'array', items: { type: 'string' } },
            missingSkills: { type: 'array', items: { type: 'string' } },
            resumeType: { type: 'string', enum: ['Admin', 'Developer'] }
          },
          required: ['score', 'summary', 'matchedSkills', 'missingSkills', 'resumeType']
        }
      }
    },
    messages: [
      { role: 'system', content: 'Evaluate only facts explicitly present in the resume and job. Never infer certifications, years, metrics, employers, or skills.' },
      { role: 'user', content: `JOB\n${JSON.stringify(job)}\n\nRESUME\n${resumeText.slice(0, 30000)}` }
    ]
  });
  return parseJsonContent(data);
}

export async function tailorResume(config, job, resumeText) {
  const data = await request(config, {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: 'Rewrite the supplied resume for the job. Preserve every fact. Never invent or strengthen employers, titles, dates, technologies, certifications, metrics, education, or scope. If the job asks for something absent, omit it. Return clean Markdown only.' },
      { role: 'user', content: `JOB\n${JSON.stringify(job)}\n\nSOURCE RESUME\n${resumeText.slice(0, 30000)}` }
    ]
  });
  return data?.choices?.[0]?.message?.content || '';
}
