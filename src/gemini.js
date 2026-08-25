const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generate(config, prompt, schema, maxOutputTokens) {
  const response = await fetch(`${API_ROOT}/${encodeURIComponent(config.geminiModel)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens,
        ...(schema ? {
          responseFormat: { text: { mimeType: 'application/json', schema } }
        } : {})
      }
    })
  });
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw new Error('Gemini returned no text content');
  return schema ? JSON.parse(text) : text;
}

const jobSchema = {
  type: 'array',
  maxItems: 30,
  items: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' },
      remoteType: { type: 'string' }, url: { type: 'string' }, postedDate: { type: ['string', 'null'] },
      salary: { type: ['string', 'null'] }, description: { type: 'string' }, source: { type: 'string' }
    },
    required: ['title', 'company', 'location', 'remoteType', 'url', 'postedDate', 'salary', 'description', 'source']
  }
};

export async function normalizeJobs(config, searchResults) {
  return generate(config, `Today is ${new Date().toISOString().slice(0, 10)}. Convert the search results below into unique, currently open Salesforce Administrator or Salesforce Developer job postings. Keep only nationwide US remote roles, DC/DMV metro roles, or Atlanta metro roles. Reject staffing-list pages, search-result pages, uncertain roles, and onsite/hybrid roles outside those locations. Preserve the direct posting URL. Do not invent missing facts; use an empty string or null.\n\nSEARCH RESULTS\n${JSON.stringify(searchResults).slice(0, 70000)}`, jobSchema, 3000);
}

const scoreSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 }, summary: { type: 'string' },
    matchedSkills: { type: 'array', items: { type: 'string' } },
    missingSkills: { type: 'array', items: { type: 'string' } },
    resumeType: { type: 'string', enum: ['Admin', 'Developer'] }
  },
  required: ['score', 'summary', 'matchedSkills', 'missingSkills', 'resumeType']
};

export async function scoreJob(config, job, resumeText) {
  return generate(config, `Evaluate only facts explicitly present in the resume and job. Never infer certifications, years, metrics, employers, or skills. Return a realistic match score.\n\nJOB\n${JSON.stringify(job)}\n\nRESUME\n${resumeText.slice(0, 30000)}`, scoreSchema, 800);
}

export async function tailorResume(config, job, resumeText) {
  return generate(config, `Rewrite the supplied resume for the job. Preserve every fact. Never invent or strengthen employers, titles, dates, technologies, certifications, metrics, education, or scope. If the job asks for something absent, omit it. Return clean Markdown only.\n\nJOB\n${JSON.stringify(job)}\n\nSOURCE RESUME\n${resumeText.slice(0, 30000)}`, null, 2600);
}
