export const SUPPORT_SLA_TARGETS = {
  low: { firstResponseMinutes: 1440, resolutionMinutes: 10080 },
  normal: { firstResponseMinutes: 480, resolutionMinutes: 4320 },
  high: { firstResponseMinutes: 120, resolutionMinutes: 1440 },
  urgent: { firstResponseMinutes: 30, resolutionMinutes: 480 },
};

const firstCustomerMessage = (conversation) =>
  conversation.messages?.find((message) => message.senderType === "customer") || null;

const firstAgentMessage