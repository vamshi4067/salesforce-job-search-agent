export function loadConfig(env = process.env) {
  const required = ['OPENROUTER_API_KEY'];
  if (env.DRY_RUN !== 'true') required.push('SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_LOGIN_URL', 'SUMMARY_EMAIL');
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  return {
    openRouterKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6',
    sfClientId: env.SF_CLIENT_ID,
    sfClientSecret: env.SF_CLIENT_SECRET,
    sfLoginUrl: env.SF_LOGIN_URL?.replace(/\/$/, ''),
    summaryEmail: env.SUMMARY_EMAIL || '',
    dryRun: env.DRY_RUN === 'true',
    minimumScore: Number(env.MINIMUM_SCORE || 70),
    maximumJobs: Number(env.MAXIMUM_JOBS || 10)
  };
}
