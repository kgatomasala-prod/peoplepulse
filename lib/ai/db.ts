import { PrismaClient } from "@prisma/client";

/**
 * Database operations for AI conversations.
 */

export const saveAIConversation = async (
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  messages: any
) => {
  return await prisma.aIConversation.create({
    data: {
      organizationId,
      userId,
      messages,
    },
  });
};

export const getAIConversationHistory = async (
  prisma: PrismaClient,
  organizationId: string,
  userId: string
) => {
  return await prisma.aIConversation.findFirst({
    where: {
      organizationId,
      userId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};
