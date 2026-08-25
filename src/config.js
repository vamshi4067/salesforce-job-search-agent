export function loadConfig(env = process.env) {
  const required = ['GEMINI_API_KEY', 'TAVILY_API_KEY'];
  if (env.DRY_RUN !== 'true') required.push('SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_LOGIN_URL', 'SUMMARY_EMAIL');
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  return {
    geminiKey: env.GEMINI_API_KEY,
    tavilyKey: env.TAVILY_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.6-flash',
    sfClientId: env.SF_CLIENT_ID,
    sfClientSecret: env.SF_CLIENT_SECRET,
    sfLoginUrl: env.SF_LOGIN_URL?.replace(/\/$/, ''),
    summaryEmail: env.SUMMARY_EMAIL || '',
    dryRun: env.DRY_RUN === 'true',
    minimumScore: Number(env.MINIMUM_SCORE || 70),
    maximumJobs: Number(env.MAXIMUM_JOBS || 10)
  };
}
