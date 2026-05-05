import { z } from 'zod';
import { router, orgProcedure } from '../trpc';
import { getHRAdvice, generateHRDocument, saveAIConversation } from '../ai';

export const aiRouter = router({
  /**
   * Ask the AI Assistant for HR advice.
   */
  ask: orgProcedure
    .input(z.object({
      message: z.string(),
      context: z.object({
        orgName: z.string(),
        industry: z.string(),
        employeeCount: z.number(),
        employeeName: z.string().optional(),
        jobTitle: z.string().optional(),
        startDate: z.string().optional(),
        salary: z.string().optional(),
        leaveBalance: z.string().optional(),
      }),
      history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { message, context, history } = input;
      const response = await getHRAdvice(message, context, history);
      
      // Store in database
      if (ctx.auth.organizationId) {
        await saveAIConversation(
          ctx.prisma, 
          ctx.auth.organizationId, 
          ctx.auth.id, 
          [
            ...(history || []),
            { role: 'user', content: message },
            { role: 'assistant', content: response }
          ]
        );
      }
      
      return { response };
    }),

  /**
   * Generate a legal HR document draft.
   */
  generateDocument: orgProcedure
    .input(z.object({
      type: z.enum(['contract', 'warning', 'termination', 'appointment', 'show-cause']),
      context: z.any(),
      additionalDetails: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { type, context, additionalDetails } = input;
      const response = await generateHRDocument(type, context, additionalDetails || '');
      return { draft: response };
    }),
});
