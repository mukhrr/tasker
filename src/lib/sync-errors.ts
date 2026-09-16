const ERROR_PATTERNS: [RegExp, string][] = [
  [
    /invalid.x-api-key|invalid_api_key|authentication_error/i,
    'Invalid Claude API key. Check your key in Settings.',
  ],
  [
    /credit|balance|billing|payment_required/i,
    'Claude API credit exhausted. Check your Anthropic billing.',
  ],
  [
    /rate.limit|too.many.requests|429/i,
    'Rate limited. Try again in a few minutes.',
  ],
  [
    /usage limit|quota/i,
    'CLI usage limit reached. Wait for your plan to reset.',
  ],
  [
    /not logged in|invalid.*(oauth|token)|login expired|refresh token/i,
    'CLI login expired. Reconnect Claude or Codex in Settings.',
  ],
  [
    /timed out|exited \d+/i,
    'Sync worker could not complete the CLI run. Try again.',
  ],
  [
    /GitHub API error: 401/i,
    'GitHub token expired. Reconnect GitHub in Settings.',
  ],
  [
    /GitHub API error: 403/i,
    'GitHub token lacks permissions or is rate-limited.',
  ],
  [
    /GitHub API error: 404/i,
    'GitHub issue not found. Check the URL is correct.',
  ],
  [
    /Could not parse issue URL/i,
    'Invalid issue URL format. Use a GitHub issue link.',
  ],
  [
    /Could not parse AI response/i,
    'AI returned an unexpected response. Try syncing again.',
  ],
  [
    /ENOTFOUND|ECONNREFUSED|fetch failed/i,
    'Network error. Check your internet connection.',
  ],
];

export function friendlySyncError(raw: string): string {
  for (const [pattern, message] of ERROR_PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  return raw;
}
