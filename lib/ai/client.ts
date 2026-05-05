import Anthropic from '@anthropic-ai/sdk';

/**
 * Shared Anthropic Claude API client.
 * Uses CLAUDE_API_KEY from environment variables.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export default anthropic;
