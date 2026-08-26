const API_URL = 'https://api.tavily.com/search';

async function search(config, query) {
  const startDate = new Date(Date.now() - config.postedWithinDays * 86400000).toISOString().slice(0, 10);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.tavilyKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, topic: 'general', search_depth: 'basic', max_results: 10, start_date: startDate,
      include_answer: false, include_raw_content: false,
      exclude_domains: [
        'linkedin.com', 'indeed.com', 'glassdoor.com', 'arc.dev', 'builtin.com',
        'builtinnyc.com', 'ziprecruiter.com', 'dice.com', 'monster.com',
        'careerbuilder.com', 'simplyhired.com', 'talent.com'
      ]
    })
  });
  if (!response.ok) throw new Error(`Tavily search failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return (data.results || []).map((result) => ({ title: result.title, url: result.url, content: result.content, score: result.score }));
}

export async function searchJobs(config) {
  const year = new Date().getUTCFullYear();
  const queries = [
    `direct employer careers Salesforce Administrator United States remote hybrid onsite apply ${year}`,
    `direct employer careers Salesforce Developer United States remote hybrid onsite apply ${year}`,
    `site:myworkdayjobs.com OR site:greenhouse.io OR site:lever.co OR site:ashbyhq.com Salesforce Administrator Developer United States ${year}`
  ];
  return (await Promise.all(queries.map((query) => search(config, query)))).flat();
}
