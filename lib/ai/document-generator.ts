import { HRAssistantContext, getHRAdvice } from './claude-service';

export const generateDraft = async (
  type: 'contract' | 'warning' | 'termination' | 'appointment' | 'show-cause',
  context: HRAssistantContext,
  additionalDetails: string
) => {
  const prompt = `You are a document generator. Generate a formal ${type} letter for a Botswana company.
  
Context:
- Company: ${context.orgName} (${context.industry})
- Employee: ${context.employeeName || 'N/A'}
- Position: ${context.jobTitle || 'N/A'}
- Start Date: ${context.startDate || 'N/A'}
- Details: ${additionalDetails}

The document MUST:
1. Follow Botswana Employment Act (Cap. 47:01) requirements.
2. Use professional legal language.
3. Include placeholders for signatures [Employer Signature] and [Employee Signature].
4. Include the date of issue.

Provide ONLY the document text, no conversational filler.`;

  return getHRAdvice(prompt, context);
};
