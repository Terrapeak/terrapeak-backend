import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Session from "../models/sessionModel.js";
import {
  ChatReservationContextError,
  resolveChatReservationContext,
} from "../services/chatReservationContextService.js";
import { isReservationDomainIntent } from "../services/aiReservationConversationService.js";
import { logAiReservationEvent, measureAiReservationStage, setAiReservationTrace } from "../utils/aiReservationLogger.js";

const reservationIntent = (message = "") => isReservationDomainIntent(message);

const reservationSessionActive = (session) =>
  Boolean(
    session &&
      (session.bookingType === "reservation" ||
        session.reservationStep ||
        session.cancelReservationStep ||
        session.reservationRescheduleStep ||
        session.rescheduleReservationId ||
        session.cancelReservationId ||
        (session.reservationFlow?.status && session.reservationFlow.status !== "idle"))
  );

export default async function requireReservationTenantForChat(req, res, next) {
  try {
    req.aiReservationTraceId ||= randomUUID();
    setAiReservationTrace(req.aiReservationTraceId);
    const apiKey = req.headers["x-api-key"];
    const { sessionId, chatbotId, message } = req.body || {};

    if (!apiKey || !chatbotId) return next();

    let session = null;
    if (sessionId) {
      session = await measureAiReservationStage({
        stage: "middleware_session_load",
        operation: "mongo_middleware_session_load",
      }, () => Session.findOne({
        sessionId,
        chatbotId,
      }));
    }

    const intentStartedAt = performance.now();
    const reservationRequested =
      reservationIntent(message) || reservationSessionActive(session);
    logAiReservationEvent("reservation_performance_stage", {
      stage: "middleware_intent_detection",
      operation: "reservation_intent_detection",
      durationMs: Math.round(performance.now() - intentStartedAt),
      success: true,
    });

    req.chatRequestContext = {
      ...(req.chatRequestContext || {}),
      session,
      sessionFound: Boolean(session),
    };

    if (!reservationRequested) return next();

    const context = await measureAiReservationStage({
      stage: "middleware_context_resolution",
      operation: "resolve_chat_reservation_context",
    }, () => resolveChatReservationContext({
      apiKey,
      chatbotId,
      sessionId,
      onResolved: ({ settings, company, installation }) => {
        req.chatRequestContext = {
          settings,
          company,
          installation,
          session,
          sessionFound: Boolean(session),
        };
      },
    }));
    req.chatReservationContext = context;
    req.chatRequestContext = {
      ...(req.chatRequestContext || {}),
      reservationContext: context,
      session,
      sessionFound: Boolean(session),
    };
    return next();
  } catch (error) {
    if (error instanceof ChatReservationContextError) {
      return res.json({
        success: true,
        reply: "Reservations are not available for this business right now. Please use the existing booking form or contact the business directly.",
        code: error.code,
      });
    }
    return next(error);
  }
}
