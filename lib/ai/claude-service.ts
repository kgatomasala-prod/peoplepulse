import { anthropic } from './client';
import { HR_ASSISTANT_SYSTEM_PROMPT } from './prompts';

export interface HRAssistantContext {
  orgName: string;
  industry: string;
  employeeCount: number;
  employeeName?: string;
  jobTitle?: string;
  startDate?: string;
  salary?: string;
  leaveBalance?: string;
}

export const getHRAdvice = async (
  message: string,
  context: HRAssistantContext,
  history: { role: 'user' | 'assistant'; content: string }[] = []
) => {
  // Inject context into system prompt
  const systemPrompt = HR_ASSISTANT_SYSTEM_PROMPT
    .replace('{orgName}', context.orgName)
    .replace('{industry}', context.industry)
    .replace('{employeeCount}', context.employeeCount.toString())
    .replace('{employeeName}', context.employeeName || 'N/A')
    .replace('{jobTitle}', context.jobTitle || 'N/A')
    .replace('{startDate}', context.startDate || 'N/A')
    .replace('{salary}', context.salary || 'N/A')
    .replace('{leaveBalance}', context.leaveBalance || 'N/A');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      ...history,
      { role: 'user', content: message }
    ],
  });

  return response.content[0].text;
};

export const generateHRDocument = async (
  type: 'contract' | 'warning' | 'termination' | 'appointment' | 'show-cause',
  context: HRAssistantContext,
  additionalDetails: string
) => {
  const prompt = `Generate a formal draft for a ${type}. 
  Additional details/reason: ${additionalDetails}. 
  Use the company and employee context provided in the system prompt. 
  The draft should be professional and compliant with the Botswana Employment Act.`;

  return getHRAdvice(prompt, context);
};
