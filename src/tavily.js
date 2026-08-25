const API_URL = 'https://api.tavily.com/search';

async function search(config, query) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.tavilyKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, topic: 'general', search_depth: 'basic', max_results: 10,
      include_answer: false, include_raw_content: false,
      exclude_domains: ['linkedin.com', 'indeed.com', 'glassdoor.com']
    })
  });
  if (!response.ok) throw new Error(`Tavily search failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return (data.results || []).map((result) => ({ title: result.title, url: result.url, content: result.content, score: result.score }));
}

export async function searchJobs(config) {
  const year = new Date().getUTCFullYear();
  const queries = [
    `Salesforce Administrator OR Senior Salesforce Administrator remote United States jobs ${year}`,
    `Salesforce Developer OR Senior Salesforce Developer remote United States jobs ${year}`,
    `Salesforce Administrator Developer jobs Washington DC DMV Northern Virginia Maryland Atlanta Georgia ${year}`
  ];
  return (await Promise.all(queries.map((query) => search(config, query)))).flat();
}
