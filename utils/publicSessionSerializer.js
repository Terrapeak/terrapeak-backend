export function serializePublicSession(session) {
  return {
    sessionId: session.sessionId,
    chatbotId: session.chatbotId,
    appointmentStep: session.appointmentStep,
    preActivationData: session.preActivationData,
    chatLogs: session.chatLogs,
    updatedAt: session.updatedAt,
  };
}
