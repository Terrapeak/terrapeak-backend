export const SUPPORT_SLA_TARGETS = {
  low: { firstResponseMinutes: 1440, resolutionMinutes: 10080 },
  normal: { firstResponseMinutes: 480, resolutionMinutes: 4320 },
  high: { firstResponseMinutes: 120, resolutionMinutes: 1440 },
  urgent: { firstResponseMinutes: 30, resolutionMinutes: 480 },
};

const minutesBetween = (start, end) => Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
const firstCustomer = (conversation) => conversation.messages?.find((message) => message.senderType === "customer") || null;
const firstAgent = (conversation, customer) => conversation.messages?.find((message) => message.senderType === "agent" && customer?.createdAt && new Date(message.createdAt) >= new Date(customer.createdAt)) || null;

export const calculateConversationSla = (conversation, now = new Date()) => {
  const priority = SUPPORT_SLA_TARGETS[conversation.priority] ? conversation.priority : "normal";
  const targets = SUPPORT_SLA_TARGETS[priority];
  const customer = firstCustomer(conversation);
  const agent = firstAgent(conversation, customer);
  const responseElapsed = customer?.createdAt ? minutesBetween(customer.createdAt, agent?.createdAt || now) : 0;
  const resolutionElapsed = conversation.createdAt ? minutesBetween(conversation.createdAt, conversation.resolvedAt || now) : 0;
  const responseRemaining = targets.firstResponseMinutes - responseElapsed;
  const resolutionRemaining = targets.resolutionMinutes - resolutionElapsed;
  const responseBreached = !agent && responseRemaining < 0;
  const resolutionBreached = conversation.status !== "resolved" && resolutionRemaining < 0;
  const responseDueSoon = !agent && !responseBreached && responseRemaining <= Math.max(30, Math.round(targets.firstResponseMinutes * 0.25));
  const resolutionDueSoon = conversation.status !== "resolved" && !resolutionBreached && resolutionRemaining <= Math.max(60, Math.round(targets.resolutionMinutes * 0.25));
  const state = responseBreached || resolutionBreached ? "breached" : responseDueSoon || resolutionDueSoon ? "due_soon" : "on_track";

  return {
    priority,
    state,
    targets,
    firstResponse: {
      completed: Boolean(agent),
      elapsedMinutes: responseElapsed,
      remainingMinutes: agent ? null : responseRemaining,
      breached: responseBreached,
      dueSoon: responseDueSoon,
    },
    resolution: {
      completed: conversation.status === "resolved",
      elapsedMinutes: resolutionElapsed,
      remainingMinutes: conversation.status === "resolved" ? null : resolutionRemaining,
      breached: resolutionBreached,
      dueSoon: resolutionDueSoon,
    },
  };
};

export const attachConversationSla = (conversation, now = new Date()) => ({
  ...conversation,
  sla: calculateConversationSla(conversation, now),
});
