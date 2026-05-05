import { anthropic } from '../../../lib/ai/client';
import { HR_ASSISTANT_SYSTEM_PROMPT } from '../../../lib/ai/prompts';
import { AnthropicStream, StreamingTextResponse } from 'ai'; 
import { getAuth } from '@clerk/nextjs/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { userId, orgId } = getAuth(req as any);
  
  if (!userId || !orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, context } = await req.json();

  // Inject context into system prompt
  const systemPrompt = HR_ASSISTANT_SYSTEM_PROMPT
    .replace('{orgName}', context.orgName || 'PeoplePulse Client')
    .replace('{industry}', context.industry || 'General')
    .replace('{employeeCount}', (context.employeeCount || 0).toString())
    .replace('{employeeName}', context.employeeName || 'N/A')
    .replace('{jobTitle}', context.jobTitle || 'N/A')
    .replace('{startDate}', context.startDate || 'N/A')
    .replace('{salary}', context.salary || 'N/A')
    .replace('{leaveBalance}', context.leaveBalance || 'N/A');

  // Create a message with the Anthropic SDK
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages,
    stream: true,
  });

  // Convert the response into a friendly text-stream
  const stream = AnthropicStream(response);

  // Respond with the stream
  return new StreamingTextResponse(stream);
}
