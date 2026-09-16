import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// One analysis call: system prompt + user prompt in, raw model text out. The
// API backend runs in the web app; the CLI backends live in syncer/analyzers.ts
// because they spawn processes the Vercel runtime cannot.
export type Analyzer = (system: string, user: string) => Promise<string>;

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export function anthropicAnalyzer(
  apiKey: string,
  model = DEFAULT_ANTHROPIC_MODEL
): Analyzer {
  const chat = new ChatAnthropic({ model, apiKey, maxTokens: 1024 });
  return async (system, user) => {
    const response = await chat.invoke([
      new SystemMessage(system),
      new HumanMessage(user),
    ]);
    return typeof response.content === 'string'
      ? response.content
      : response.content.map((c) => ('text' in c ? c.text : '')).join('');
  };
}
