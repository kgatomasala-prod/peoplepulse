/**
 * Mock database operations for AI conversations.
 * To be integrated with the actual Prisma client once available.
 */

export const saveAIConversation = async (
  prisma: any, 
  orgId: string, 
  userId: string, 
  messages: any
) => {
  return await prisma.aiConversation.create({
    data: {
      org_id: orgId,
      user_id: userId,
      messages: messages,
    },
  });
};

export const getAIConversationHistory = async (
  prisma: any, 
  orgId: string, 
  userId: string
) => {
  return await prisma.aiConversation.findFirst({
    where: {
      org_id: orgId,
      user_id: userId,
    },
    orderBy: {
      created_at: 'desc',
    },
  });
};
