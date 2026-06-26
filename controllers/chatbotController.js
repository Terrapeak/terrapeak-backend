import asyncHandler from "express-async-handler";
import ChatbotSettings from "../models/chatbotSettings.js";
import ChatbotAction from "../models/ChatbotAction.js";
import WebsiteInfo from "../models/WebsiteInfo.js";
import TimeSlot from "../models/timeSlot.js";
import { chatbotCache } from "../utils/cache.js";
import Session from "../models/sessionModel.js";
import Appointment from "../models/appointment.js";
import { createGoogleMeet, deleteGoogleEvent } from "../utils/googleMeet.js";
import User from "../models/user.js";
import axios from "axios";
import { DateTime } from "luxon";
import { extractTextFromFile } from "../utils/extractTextFromFile.js";
import { removeFile } from "../utils/upload.js";
import {
  getBusinessBySlug,
  checkReservationAvailability,
  createReservation,
  findActiveReservationsByReference,
  findActiveReservationsByPhone,
  cancelReservationById,
  updateReservationById,
} from "../utils/reservationService.js";

// List of all fields allowed to be updated
const ALLOWED_FIELDS = [
  "allowedDomains",
  "brandName",
  "botName",
  "welcomeMessage",
  "language",
  "onlineMessage",
  "offlineMessage",
  "themeColor",
  "accentColor",
  "textColor",
  "font",
  "fontSize",
  "backgroundColor",
  "bgImage",
  "bgImageWidth",
  "bgImageHeight",
  "messageAlign",
  "messageStyle",
  "avatarShape",
  "avatarSize",
  "botAvatar",
  "userAvatar",
  "showUserAvatar",
  "showBotAvatar",
  "enableGradient",
  "chatDirection",
  "deviceSizes",
  "height",
  "width",
  "borderRadius",
  "boxShadow",
  "position",
  "sendButtonLabel",
  "sendButtonIcon",
  "showTimestamp",
  "typingIndicator",
  "messageDelay",
  "typingSpeed",
  "soundOnMessage",
  "voiceGender",
  "autoScroll",
  "animations",
  "fileUpload",
  "allowEmojis",
  "allowMarkdown",
  "fullscreen",
  "systemInstruction",
  "systemInstructionFileText1",
  "systemInstructionFileText2",
  "preActivationFields",
  "requirePreActivation",
  "geminiKey",
  "gemini_model",
];
// ====================== CONFIG ======================

const MODEL = "gemini-2.5-flash-lite";
const SAFE_SYSTEM_TOKEN_LIMIT = 500000; // Recommended safe limit for system instruction
//const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const saveChatbotSettings = asyncHandler(async (req, res) => {
  const userId = req.userId;

  // Extract only whitelisted fields from body
  const updateData = {};
  ALLOWED_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  let ALLOWED_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
  ];

  if (
    req.body?.gemini_model &&
    !ALLOWED_MODELS.includes(req.body.gemini_model)
  ) {
    res.status(404).json({
      message: "not a valid model",
      success: false,
    });
  }

  updateData.userId = userId; // prevent override

  const updated = await ChatbotSettings.findOneAndUpdate(
    { userId },
    updateData,
    { upsert: true, new: true, runValidators: true }
  );

  res.json({
    message: "Chatbot settings saved successfully",
    success: true,
    data: updated,
  });
});

export const getChatbotSettings = asyncHandler(async (req, res) => {
  const userId = req.userId;
  console.log(userId);

  const settings = await ChatbotSettings.findOne({ userId });

  if (!settings) {
    return res
      .status(404)
      .json({ success: false, message: "Chatbot settings not found." });
  }

  res.json({ success: true, data: settings });
});

export const extractInstructions = asyncHandler(async (req, res) => {
  let file;

  try {
    file = req.file;

    console.log("file ", req.file);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Extract text
    let content = "";
    content = await extractTextFromFile(file);

    // Clean text
    content = content
      .replace(/\r/g, "")
      .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
      .replace(/\s{2,}/g, " ") // remove extra spaces
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Limit size (VERY IMPORTANT for Gemini)
    // if (content.length > 10000) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Instruction too long. Please shorten the file.",
    //   });
    // }

    console.log("conttett in backend ", content);

    return res.json({
      success: true,
      data: {
        Name: file.originalname,
        FileText: content,
        setFile: true,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    // ALWAYS DELETE FILE (no storage)
    if (file?.path) {
      removeFile(file.path);
    }
  }
});

/* ===============================
   GEMINI RETRY HELPER
================================ */
async function fetchGeminiWithRetry(
  gemini_key,
  gemini_model,
  payload,
  retries = 2,
  delay = 3000
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemini_model}:generateContent?key=${gemini_key}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // if (response.status === 429) {
  //   if (retries === 0) {
  //     throw new Error("Gemini rate limit exceeded");
  //   }
  //   await new Promise((r) => setTimeout(r, delay));
  //   return fetchGeminiWithRetry(payload, retries - 1, delay * 2);
  // }

  if (!response.ok) {
    console.log(response.status);
    let res = await response.json();
    console.log("hlo", res);
    const shortMessage = res?.error?.message
      ?.split("\n")[0]
      ?.replace(/\s+/g, " ")
      ?.trim();
    throw new Error(`Gemini error: ${shortMessage}`);
  }

  return response.json();
}

/* ===============================
   ASK GEMINI CONTROLLER
================================ */
export const askGemini = asyncHandler(async (req, res) => {
  const {
    sessionId,
    chatbotId,
    userId,
    preActivationData,
    message,
    chatHistory = [],
    language,
    isPreview,
    timeZone,
  } = req.body;

  /* ===============================
     API KEY VALIDATION
  ================================ */
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(400).json({ success: false, error: "API key required." });
  }

  if (!sessionId || !chatbotId || !message) {
    return res.status(400).json({
      success: false,
      error: "sessionId, chatbotId, and message are required.",
    });
  }

  /* ===============================
     CHATBOT SETTINGS VALIDATION
  ================================ */
  const settings = await ChatbotSettings.findOne({ apiKey });

     // use only when debugging 
  // console.log("setting ", settings);

  if (!settings) {
    return res.status(403).json({ success: false, error: "Invalid API key." });
  }

  if (settings._id.toString() !== chatbotId) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid chatbotId." });
  }
  if (!settings?.geminiKey || !settings?.gemini_model) {
    return res.status(400).json({
      success: false,
      error:
        "Configuration required: Please set your Gemini API key and model.",
    });
  }

  /* ===============================
     SESSION HANDLING
  ================================ */
  let session = await Session.findOne({ sessionId });

  if (!session) {
    session = new Session({
      sessionId,
      chatbotId,
      userId: userId || null,
      preActivationData: preActivationData || {},
      chatLogs: [],
      appointmentStep: null,
      timeZone,
      isPreview: isPreview ? true : false,
    });
  } else {
    session.preActivationData = {
      ...session.preActivationData,
      ...preActivationData,
    };
  }

  /* ===============================
     THROTTLING (ANTI SPAM)
  ================================ */
  session.lastGeminiCall = session.lastGeminiCall || 0;
  const now = Date.now();

  if (now - session.lastGeminiCall < 3000) {
    return res.json({
      success: true,
      reply: "⏳ Please wait a moment before asking again.",
      appointmentStep: session.appointmentStep,
    });
  }

  session.lastGeminiCall = now;

  if (!session.reservationRescheduleStep) {
  session.reservationRescheduleStep = null;
}

if (!session.rescheduleReservationId) {
  session.rescheduleReservationId = null;
}

if (!session.rescheduleReservationOptions) {
  session.rescheduleReservationOptions = [];
}

if (!session.rescheduleReservationData) {
  session.rescheduleReservationData = {};
}
  /* ===============================
     MESSAGE + CANCEL HANDLING
  ================================ */
  const lowerMsg = message.toLowerCase().trim();
  let botReply = null;

   // ✅ Cancel current flow or existing appointment
  const isSimpleCancel =
  lowerMsg === "cancel" ||
  lowerMsg === "stop" ||
  lowerMsg === "exit" ||
  lowerMsg === "quit";

const isReservationCancelRequest =
  lowerMsg.includes("cancel") &&
  (
    lowerMsg.includes("reservation") ||
    lowerMsg.includes("table") ||
    lowerMsg.includes("booking")
  );

const isAppointmentCancelRequest =
  lowerMsg.includes("cancel") &&
  (
    lowerMsg.includes("appointment") ||
    lowerMsg.includes("meeting") ||
    lowerMsg.includes("callback") ||
    lowerMsg.includes("booking") ||
    lowerMsg.includes("scheduled")
  );

const isAppointmentRescheduleRequest =
  lowerMsg === "reschedule" ||
  lowerMsg.includes("reschedule appointment") ||
  lowerMsg.includes("reschedule my appointment") ||
  lowerMsg.includes("reschedule meeting") ||
  lowerMsg.includes("reschedule my meeting") ||
  lowerMsg.includes("reschedule callback") ||
  lowerMsg.includes("change my appointment") ||
  lowerMsg.includes("change appointment") ||
  lowerMsg.includes("move my appointment") ||
  lowerMsg.includes("move appointment");

const isReservationRescheduleRequest =
  lowerMsg.includes("reschedule reservation") ||
  lowerMsg.includes("reschedule my reservation") ||
  lowerMsg.includes("change reservation") ||
  lowerMsg.includes("change my reservation") ||
  lowerMsg.includes("move reservation") ||
  lowerMsg.includes("move my reservation") ||
  lowerMsg.includes("change table booking") ||
  lowerMsg.includes("reschedule table");

const isInsideBookingFlow =
  session.appointmentStep != null ||
  session.reservationStep != null ||
  session.bookingType === "appointment" ||
  session.bookingType === "reservation" ||
  session.bookingType === "clarify" ||

  session.cancelTypeStep != null ||
  session.cancelStep != null ||
  session.cancelAppointmentLookupStep != null ||
  session.cancelReservationStep != null ||
  session.reservationCancelStep != null ||

  session.rescheduleStep != null ||
  session.rescheduleAppointmentId != null ||

  session.reservationRescheduleStep != null ||
  session.rescheduleReservationId != null;

if (!botReply && isSimpleCancel && isInsideBookingFlow) {
  resetBookingSession(session);

  session.cancelTypeStep = null;
  session.forceAppointmentCancel = false;

  session.cancelStep = null;
  session.cancelAppointmentId = null;
  session.cancelAppointmentOptions = [];
  session.cancelAppointmentLookupStep = null;

  session.cancelReservationStep = null;
  session.reservationCancelStep = null;
  session.cancelReservationId = null;
  session.cancelReservationOptions = [];

  session.rescheduleStep = null;
  session.rescheduleAppointmentId = null;
  session.rescheduleAppointmentOptions = [];
  session.isRescheduling = false;

  session.reservationRescheduleStep = null;
  session.rescheduleReservationId = null;
  session.rescheduleReservationOptions = [];
  session.rescheduleReservationData = {};

  botReply =
    "Okay 👍 I cancelled the current process. How else can I help you?";
}

if (
  !botReply &&
  lowerMsg === "cancel" &&
  !isInsideBookingFlow
) {
  
  session.cancelTypeStep = "chooseCancelType";

  botReply =
  "What would you like to cancel?<br><br>" +
  "<b>1)</b> Appointment<br>" +
  "<b>2)</b> Reservation<br><br>" +
  "Please reply with 1 or 2.";
}

if (!botReply && session.reservationRescheduleStep === "askLookup") {
  const lookupValue = message.trim();

  try {
    const businessSlug =
      session.reservationBusinessSlug ||
      process.env.RESERVATION_BUSINESS_SLUG ||
      "dim-sum-dragon";

    const business = await getBusinessBySlug(businessSlug);

    let reservations = [];

    if (lookupValue.includes("-")) {
      reservations = await findActiveReservationsByReference({
        businessId: business.id,
        reservationReference: lookupValue,
      });
    } else {
      reservations = await findActiveReservationsByPhone({
        businessId: business.id,
        phone: lookupValue,
      });
    }

    if (!reservations.length) {
      session.reservationRescheduleStep = null;
      session.rescheduleReservationId = null;
      session.rescheduleReservationOptions = [];
      session.rescheduleReservationData = {};

      botReply =
        "I could not find an active reservation with that reference or phone number.";
    } else if (reservations.length === 1) {
      const reservation = reservations[0];

      session.reservationRescheduleStep = "askDate";
      session.rescheduleReservationId = reservation.id.toString();
      session.rescheduleReservationOptions = [];
      session.rescheduleReservationData = reservation;

      botReply = `I found this reservation:

${formatReservationForChat(reservation)}

What new date would you like? Reply with YYYY-MM-DD, or type **same** to keep the current date.`;
    } else {
      session.reservationRescheduleStep = "selectReservationToReschedule";
      session.rescheduleReservationOptions = reservations.map((reservation) =>
        reservation.id.toString()
      );

      const reservationList = reservations
        .map((reservation, index) => {
          return `<b>${index + 1})</b> ${formatReservationShortForChat(reservation)}`;
        })
        .join("<br>");

      botReply = `I found multiple active reservations:<br><br>

${reservationList}<br><br>

Which reservation would you like to reschedule? Please reply with the reservation number.`;
    }
  } catch (err) {
    console.error("Reservation reschedule lookup error:", err);

    session.reservationRescheduleStep = null;
    session.rescheduleReservationId = null;
    session.rescheduleReservationOptions = [];
    session.rescheduleReservationData = {};

    botReply =
      "Sorry, I could not look up your reservation right now. Please try again later.";
  }
}

if (!botReply && session.cancelReservationStep === "askLookup") {
  const lookupValue = message.trim();

  try {
    const businessSlug =
      session.reservationBusinessSlug ||
      process.env.RESERVATION_BUSINESS_SLUG ||
      "dim-sum-dragon";

    const business = await getBusinessBySlug(businessSlug);

    let reservations = [];

    if (lookupValue.includes("-")) {
      reservations = await findActiveReservationsByReference({
        businessId: business.id,
        reservationReference: lookupValue,
      });
    } else {
      reservations = await findActiveReservationsByPhone({
        businessId: business.id,
        phone: lookupValue,
      });
    }

    if (!reservations.length) {
      session.cancelReservationStep = null;
      session.cancelReservationId = null;
      session.cancelReservationOptions = [];

      botReply =
        "I could not find an active reservation with that reference or phone number.";
    } else if (reservations.length === 1) {
      const reservation = reservations[0];

      session.cancelReservationStep = "confirmCancel";
      session.cancelReservationId = reservation.id.toString();
      session.cancelReservationOptions = [];

      botReply = `I found this reservation:

${formatReservationForChat(reservation)}

Are you sure you want to cancel this reservation? Please reply **yes** or **no**.`;
    } else {
      session.cancelReservationStep = "selectReservationToCancel";
      session.cancelReservationOptions = reservations.map((reservation) =>
        reservation.id.toString()
      );

      const reservationList = reservations
        .map((reservation, index) => {
          return `**${index + 1}.** ${formatReservationShortForChat(reservation)}`;
        })
        .join("\n");

      botReply = `I found multiple active reservations:

${reservationList}

Which reservation would you like to cancel? Please reply with the reservation number.`;
    }
  } catch (err) {
    console.error("Reservation lookup error:", err);

    session.cancelReservationStep = null;
    session.cancelReservationId = null;
    session.cancelReservationOptions = [];

    botReply =
      "Sorry, I could not look up your reservation right now. Please try again later.";
  }
}

if (!botReply && session.cancelTypeStep === "chooseCancelType") {
  if (lowerMsg === "1" || lowerMsg.includes("appointment")) {
  session.cancelTypeStep = null;
  session.cancelAppointmentLookupStep = "askPhone";

  botReply =
    "Okay. Please provide the phone number used for the appointment.";
}

  else if (lowerMsg === "2" || lowerMsg.includes("reservation")) {
    session.cancelTypeStep = null;

    session.reservationCancelStep = "awaitingLookup";

    botReply =
      "Sure. Please provide your reservation reference number or the phone number used for the reservation.";
  }

  else {
    botReply =
       "Please reply with:<br><br><b>1)</b> Appointment<br><b>2)</b> Reservation";
  }
}

if (!botReply && session.reservationRescheduleStep === "selectReservationToReschedule") {
  const choice = parseInt(message.trim(), 10);
  const reservationId = session.rescheduleReservationOptions?.[choice - 1];

  if (!reservationId) {
    botReply =
      "Please reply with a valid reservation number from the list.";
  } else {
    try {
      const businessSlug =
        session.reservationBusinessSlug ||
        process.env.RESERVATION_BUSINESS_SLUG ||
        "dim-sum-dragon";

      const business = await getBusinessBySlug(businessSlug);

      const reservations = await findActiveReservationsByPhone({
        businessId: business.id,
        phone: session.rescheduleReservationData?.phone || "",
      });

      const selectedReservation = reservations.find(
        (reservation) => String(reservation.id) === String(reservationId)
      );

      if (!selectedReservation) {
        botReply =
          "I could not find that active reservation anymore.";
        session.reservationRescheduleStep = null;
        session.rescheduleReservationId = null;
        session.rescheduleReservationOptions = [];
        session.rescheduleReservationData = {};
      } else {
        session.reservationRescheduleStep = "askDate";
        session.rescheduleReservationId = selectedReservation.id.toString();
        session.rescheduleReservationOptions = [];
        session.rescheduleReservationData = selectedReservation;

        botReply = `You selected this reservation:

${formatReservationForChat(selectedReservation)}

What new date would you like? Reply with YYYY-MM-DD, or type **same** to keep the current date.`;
      }
    } catch (err) {
      console.error("Reservation selection error:", err);

      session.reservationRescheduleStep = null;
      session.rescheduleReservationId = null;
      session.rescheduleReservationOptions = [];
      session.rescheduleReservationData = {};

      botReply =
        "Sorry, I could not select that reservation right now. Please try again.";
    }
  }
}

if (!botReply && session.cancelReservationStep === "selectReservationToCancel") {
  const choice = parseInt(message.trim(), 10);
  const reservationId = session.cancelReservationOptions?.[choice - 1];

  if (!reservationId) {
    botReply =
      "Please reply with a valid reservation number from the list.";
  } else {
    session.cancelReservationStep = "confirmCancel";
    session.cancelReservationId = reservationId;
    session.cancelReservationOptions = [];

    botReply =
      "Are you sure you want to cancel this reservation? Please reply **yes** or **no**.";
  }
}

if (!botReply && session.reservationRescheduleStep === "askDate") {
  const currentReservation = session.rescheduleReservationData || {};

  session.rescheduleReservationData = {
    ...currentReservation,
    reservation_date:
      lowerMsg === "same"
        ? currentReservation.reservation_date
        : message.trim(),
  };

  session.reservationRescheduleStep = "askTime";

  botReply =
    "What new time would you like? Reply with HH:MM, for example 19:00, or type **same** to keep the current time.";
}

if (!botReply && session.reservationRescheduleStep === "askTime") {
  const currentReservation = session.rescheduleReservationData || {};

  const normalizedTime =
    lowerMsg === "same"
      ? currentReservation.reservation_time
      : message.trim().replace(".", ":");

  const available = await checkReservationAvailability({
    businessId: currentReservation.business_id,
    reservationDate: currentReservation.reservation_date,
    reservationTime: normalizedTime,
    partySize: currentReservation.party_size,
    excludeReservationId: session.rescheduleReservationId,
  });

  if (!available) {
  botReply =
    "Sorry, that time is outside opening hours or fully booked. Please choose another time in HH:MM format.";
} else {
  session.rescheduleReservationData = {
    ...currentReservation,
    reservation_time: normalizedTime,
  };

  session.reservationRescheduleStep = "askPartySize";

  botReply =
    "How many people should the reservation be for? Type **same** to keep the current party size.";
  }
}

if (!botReply && session.reservationRescheduleStep === "askPartySize") {
  const currentReservation = session.rescheduleReservationData || {};

  if (lowerMsg !== "same" && (isNaN(Number(message)) || Number(message) < 1)) {
    botReply =
      "Please enter a valid number of guests, or type **same** to keep the current party size.";
  } else {
    const newPartySize =
      lowerMsg === "same"
        ? Number(currentReservation.party_size)
        : Number(message);

    const available = await checkReservationAvailability({
      businessId: currentReservation.business_id,
      reservationDate: currentReservation.reservation_date,
      reservationTime: currentReservation.reservation_time,
      partySize: newPartySize,
      excludeReservationId: session.rescheduleReservationId,
    });

    if (!available) {
      botReply =
        "Sorry, that party size is too large for the selected time slot. Please enter a smaller number of guests or choose another time.";
    } else {
      session.rescheduleReservationData = {
        ...currentReservation,
        party_size: newPartySize,
      };

      session.reservationRescheduleStep = "askOccasion";

      botReply =
        "What is the occasion? Type a new occasion, **same** to keep the current occasion, or **none** if there is none.";
    }
  }
}

if (!botReply && session.reservationRescheduleStep === "askOccasion") {
  const currentReservation = session.rescheduleReservationData || {};
  const currentCustomData = currentReservation.custom_data || {};

  session.rescheduleReservationData = {
    ...currentReservation,
    custom_data: {
      ...currentCustomData,
      Occasion:
        lowerMsg === "same"
          ? currentCustomData.Occasion || ""
          : lowerMsg === "none"
          ? ""
          : message.trim(),
    },
  };

  session.reservationRescheduleStep = "askAllergies";

  botReply =
    "Any allergies? Type new allergy details, **same** to keep the current allergy info, or **none** if there are none.";
}

if (!botReply && session.reservationRescheduleStep === "askAllergies") {
  const currentReservation = session.rescheduleReservationData || {};
  const currentCustomData = currentReservation.custom_data || {};

  session.rescheduleReservationData = {
    ...currentReservation,
    custom_data: {
      ...currentCustomData,
      Allergies:
        lowerMsg === "same"
          ? currentCustomData.Allergies || ""
          : lowerMsg === "none"
          ? ""
          : message.trim(),
    },
  };

  session.reservationRescheduleStep = "askSeatingPreference";

  botReply =
    "Any seating preference? Type a new preference, **same** to keep the current preference, or **none** if there is none.";
}

if (!botReply && session.reservationRescheduleStep === "askSeatingPreference") {
  const currentReservation = session.rescheduleReservationData || {};
  const currentCustomData = currentReservation.custom_data || {};

  session.rescheduleReservationData = {
    ...currentReservation,
    custom_data: {
      ...currentCustomData,
      "Seating Preference":
        lowerMsg === "same"
          ? currentCustomData["Seating Preference"] || ""
          : lowerMsg === "none"
          ? ""
          : message.trim(),
    },
  };

  session.reservationRescheduleStep = "askSpecialRequest";

  botReply =
    "Any special requests? Type a new request, **same** to keep the current request, or **none** for no special requests.";
}

if (!botReply && session.reservationRescheduleStep === "askSpecialRequest") {
  const currentReservation = session.rescheduleReservationData || {};

  const newSpecialRequest =
    lowerMsg === "same"
      ? currentReservation.special_request || ""
      : lowerMsg === "none"
      ? ""
      : message.trim();

  session.rescheduleReservationData = {
    ...currentReservation,
    special_request: newSpecialRequest,
  };

  try {
    const businessSlug =
      session.reservationBusinessSlug ||
      process.env.RESERVATION_BUSINESS_SLUG ||
      "dim-sum-dragon";

    const business = await getBusinessBySlug(businessSlug);

    console.log("RESCHEDULE AVAILABILITY CHECK:", {
  businessId: business.id,
  reservationDate: session.rescheduleReservationData.reservation_date,
  reservationTime: session.rescheduleReservationData.reservation_time,
  partySize: session.rescheduleReservationData.party_size,
  excludeReservationId: session.rescheduleReservationId,
});

    const available = await checkReservationAvailability({
      businessId: business.id,
      reservationDate: session.rescheduleReservationData.reservation_date,
      reservationTime: session.rescheduleReservationData.reservation_time,
      partySize: session.rescheduleReservationData.party_size,
      excludeReservationId: session.rescheduleReservationId,
    });

    if (!available) {
      botReply =
        "Sorry, that reservation slot is fully booked. Please choose another time.";

      session.reservationRescheduleStep = "askTime";
      return;
    }

    session.reservationRescheduleStep = "confirmUpdate";

const customData =
  session.rescheduleReservationData.custom_data || {};

botReply = `Please confirm the updated reservation details:

Reference: ${session.rescheduleReservationData.reservation_reference}

Date: ${session.rescheduleReservationData.reservation_date}
Time: ${session.rescheduleReservationData.reservation_time}
Party size: ${session.rescheduleReservationData.party_size}

Occasion: ${customData.Occasion || "None"}
Allergies: ${customData.Allergies || "None"}
Seating Preference: ${customData["Seating Preference"] || "None"}
Special Request: ${session.rescheduleReservationData.special_request || "None"}

Reply YES to update the reservation.
Reply NO to cancel the reschedule request.`;

  } catch (err) {
    console.error("Reservation reschedule update error:", err);

    session.reservationRescheduleStep = null;
    session.rescheduleReservationId = null;
    session.rescheduleReservationOptions = [];
    session.rescheduleReservationData = {};

    botReply =
      "Sorry, I could not update the reservation right now. Please try again or use the reservation form.";
  }
}

if (!botReply && session.reservationRescheduleStep === "confirmUpdate") {
  if (lowerMsg === "yes" || lowerMsg === "y") {
    try {
      const businessSlug =
        session.reservationBusinessSlug ||
        process.env.RESERVATION_BUSINESS_SLUG ||
        "dim-sum-dragon";

      const business = await getBusinessBySlug(businessSlug);

      const updatedReservation = await updateReservationById({
        businessId: business.id,
        reservationId: session.rescheduleReservationId,
        reservationDate: session.rescheduleReservationData.reservation_date,
        reservationTime: session.rescheduleReservationData.reservation_time,
        partySize: session.rescheduleReservationData.party_size,
        specialRequest: session.rescheduleReservationData.special_request,
        customData: session.rescheduleReservationData.custom_data || {},
      });

      session.reservationRescheduleStep = null;
      session.rescheduleReservationId = null;
      session.rescheduleReservationOptions = [];
      session.rescheduleReservationData = {};

      const customData = updatedReservation.custom_data || {};

      botReply = `✅ Your reservation has been updated successfully.

Reference: ${updatedReservation.reservation_reference}

Date: ${updatedReservation.reservation_date}
Time: ${updatedReservation.reservation_time}
Party size: ${updatedReservation.party_size}

Occasion: ${customData.Occasion || "None"}
Allergies: ${customData.Allergies || "None"}
Seating Preference: ${customData["Seating Preference"] || "None"}
Special Request: ${updatedReservation.special_request || "None"}`;
    } catch (err) {
      console.error("Reservation reschedule confirmation error:", err);

      session.reservationRescheduleStep = null;
      session.rescheduleReservationId = null;
      session.rescheduleReservationOptions = [];
      session.rescheduleReservationData = {};

      botReply =
        "Sorry, I could not update the reservation right now. Please try again or use the reservation form.";
    }
  } else if (lowerMsg === "no" || lowerMsg === "n") {
    session.reservationRescheduleStep = null;
    session.rescheduleReservationId = null;
    session.rescheduleReservationOptions = [];
    session.rescheduleReservationData = {};

    botReply = "No problem. Your reservation was not changed.";
  } else {
    botReply =
      "Please reply **yes** to update the reservation or **no** to cancel the reschedule request.";
  }
}

if (!botReply && session.cancelReservationStep === "confirmCancel") {
  if (lowerMsg === "yes") {
    try {
      const businessSlug =
        session.reservationBusinessSlug ||
        process.env.RESERVATION_BUSINESS_SLUG ||
        "dim-sum-dragon";

      const business = await getBusinessBySlug(businessSlug);

      const reservation = await cancelReservationById({
        businessId: business.id,
        reservationId: session.cancelReservationId,
      });

      session.cancelReservationStep = null;
      session.cancelReservationId = null;
      session.cancelReservationOptions = [];

      botReply = `✅ Your reservation has been cancelled successfully.

**Reference:** ${reservation.reservation_reference}  
**Date:** ${reservation.reservation_date}  
**Time:** ${reservation.reservation_time}`;
    } catch (err) {
      console.error("Reservation cancellation error:", err);

      session.cancelReservationStep = null;
      session.cancelReservationId = null;
      session.cancelReservationOptions = [];

      botReply =
        "Sorry, I could not cancel the reservation right now. Please try again or use the reservation form.";
    }
  } else if (lowerMsg === "no") {
    session.cancelReservationStep = null;
    session.cancelReservationId = null;
    session.cancelReservationOptions = [];

    botReply = "No problem. Your reservation remains confirmed.";
  } else {
    botReply =
      "Please reply **yes** to cancel the reservation or **no** to keep it.";
  }
}

if (!botReply && isReservationRescheduleRequest) {
  session.reservationRescheduleStep = "askLookup";
  session.rescheduleReservationId = null;
  session.rescheduleReservationOptions = [];
  session.rescheduleReservationData = {};

  botReply =
    "Sure. Please provide your reservation reference number or the phone number used for the reservation.";
}

if (!botReply && isReservationCancelRequest) {
  session.cancelReservationStep = "askLookup";

  botReply =
    "Sure. Please provide your reservation reference number or the phone number used for the reservation.";
}

if (!botReply && session.rescheduleStep === "askPhone") {
  const phone = message.trim();

  const activeAppointments = await Appointment.find({
    ownerId: settings.userId,
    phone,
    status: { $ne: "cancelled" },
  })
    .populate("timeSlotId")
    .sort({ createdAt: -1 });

  if (!activeAppointments.length) {
    session.rescheduleStep = null;
    session.rescheduleAppointmentId = null;
    session.rescheduleAppointmentOptions = [];

    botReply =
      "I could not find an active appointment with that phone number.";
  } else if (activeAppointments.length === 1) {
    const appointment = activeAppointments[0];
    const slot = appointment.timeSlotId;
    const formatted = formatAppointmentForChat(appointment, slot);

    session.rescheduleStep = "confirmReschedule";
    session.rescheduleAppointmentId = appointment._id.toString();

    botReply = `I found this appointment:

${formatted}

Do you want to reschedule this appointment? Please reply **yes** or **no**.`;
  } else {
    session.rescheduleStep = "selectAppointmentToReschedule";
    session.rescheduleAppointmentOptions = activeAppointments.map((appointment) =>
      appointment._id.toString()
    );

    const appointmentList = activeAppointments
      .map((appointment, index) => {
        const slot = appointment.timeSlotId;
        const formatted = formatAppointmentShortForChat(appointment, slot);

        return `**${index + 1}.** ${formatted}`;
      })
      .join("\n");

    botReply = `I found multiple active appointments with that phone number:

${appointmentList}

Which appointment would you like to reschedule? Please reply with the appointment number.`;
  }
}

if (!botReply && session.cancelAppointmentLookupStep === "askPhone") {
  const phone = message.trim();

  const activeAppointments = await Appointment.find({
    ownerId: settings.userId,
    phone,
    status: { $ne: "cancelled" },
  })
    .populate("timeSlotId")
    .sort({ createdAt: -1 });

  session.cancelAppointmentLookupStep = null;

  if (!activeAppointments.length) {
    botReply =
      "I could not find an active appointment with that phone number.";
  } else if (activeAppointments.length === 1) {
    const appointment = activeAppointments[0];
    const slot = appointment.timeSlotId;

    const formatted = formatAppointmentForChat(appointment, slot);

    session.cancelStep = "confirmCancel";
    session.cancelAppointmentId = appointment._id.toString();

    botReply = `I found this appointment:

${formatted}

Are you sure you want to cancel this appointment? Please reply **yes** or **no**.`;
  } else {
    session.cancelStep = "selectAppointmentToCancel";
    session.cancelAppointmentOptions = activeAppointments.map((appointment) =>
      appointment._id.toString()
    );

    const appointmentList = activeAppointments
      .map((appointment, index) => {
        const slot = appointment.timeSlotId;
        const formatted = formatAppointmentShortForChat(appointment, slot);

        return `**${index + 1}.** ${formatted}`;
      })
      .join("\n");

    botReply = `I found multiple active appointments with that phone number:

${appointmentList}

Which appointment would you like to cancel? Please reply with the appointment number.`;
  }
}

if (!botReply && session.rescheduleStep === "selectAppointmentToReschedule") {
  const choice = parseInt(message.trim(), 10);
  const appointmentId = session.rescheduleAppointmentOptions?.[choice - 1];

  if (!appointmentId) {
    botReply =
      "Please reply with a valid appointment number from the list.";
  } else {
    const appointment = await Appointment.findById(appointmentId).populate(
      "timeSlotId"
    );

    if (!appointment || appointment.status === "cancelled") {
      session.rescheduleStep = null;
      session.rescheduleAppointmentId = null;
      session.rescheduleAppointmentOptions = [];

      botReply =
        "I could not find that active appointment anymore.";
    } else {
      const formatted = formatAppointmentForChat(
        appointment,
        appointment.timeSlotId
      );

      session.rescheduleStep = "confirmReschedule";
      session.rescheduleAppointmentId = appointment._id.toString();
      session.rescheduleAppointmentOptions = [];

      botReply = `You selected this appointment:

${formatted}

Do you want to reschedule this appointment? Please reply **yes** or **no**.`;
    }
  }
}

if (!botReply && session.cancelStep === "selectAppointmentToCancel") {
  const choice = parseInt(message.trim(), 10);
  const appointmentId = session.cancelAppointmentOptions?.[choice - 1];

  if (!appointmentId) {
    botReply =
      "Please reply with a valid appointment number from the list.";
  } else {
    const appointment = await Appointment.findById(appointmentId).populate(
      "timeSlotId"
    );

    if (!appointment || appointment.status === "cancelled") {
      session.cancelStep = null;
      session.cancelAppointmentId = null;
      session.cancelAppointmentOptions = [];

      botReply =
        "I could not find that active appointment anymore.";
    } else {
      const slot = appointment.timeSlotId;
      const formatted = formatAppointmentForChat(appointment, slot);

      session.cancelStep = "confirmCancel";
      session.cancelAppointmentId = appointment._id.toString();
      session.cancelAppointmentOptions = [];

      botReply = `You selected this appointment:

${formatted}

Are you sure you want to cancel this appointment? Please reply **yes** or **no**.`;
    }
  }
}

if (!botReply && session.rescheduleStep === "confirmReschedule") {
  if (lowerMsg === "yes") {
    const oldAppointment = await Appointment.findById(
      session.rescheduleAppointmentId
    );

    if (!oldAppointment || oldAppointment.status === "cancelled") {
      session.rescheduleStep = null;
      session.rescheduleAppointmentId = null;
      session.rescheduleAppointmentOptions = [];

      botReply =
        "I could not find that active appointment anymore.";
    } else {
      const owner = await User.findById(oldAppointment.ownerId);

      if (oldAppointment.googleEventId && owner) {
        await deleteGoogleEvent(owner, oldAppointment.googleEventId);
      }

      session.rescheduleStep = null;
session.rescheduleAppointmentOptions = [];
session.isRescheduling = true;

session.bookingType = "appointment";
session.appointmentStep = "askDate";

session.appointmentName = oldAppointment.name;
session.appointmentEmail = oldAppointment.email;
session.appointmentPhone = oldAppointment.phone;

botReply =
  "Okay, I found your existing appointment. Please provide the new appointment date in YYYY-MM-DD format. Your old appointment will stay active until the new one is successfully booked.";
    }
  } else if (lowerMsg === "no") {
    session.rescheduleStep = null;
    session.rescheduleAppointmentId = null;
    session.rescheduleAppointmentOptions = [];
    session.isRescheduling = false;

    botReply = "No problem. Your appointment remains scheduled.";
  } else {
    botReply =
      "Please reply **yes** to reschedule this appointment or **no** to keep it.";
  }
}

if (!botReply && session.cancelStep === "confirmCancel") {
  if (lowerMsg === "yes") {
    const appointment = await Appointment.findById(session.cancelAppointmentId);

    if (!appointment || appointment.status === "cancelled") {
      session.cancelStep = null;
      session.cancelAppointmentId = null;
      botReply = "I could not find an active appointment to cancel.";
    } else {
      const owner = await User.findById(appointment.ownerId);

      if (appointment.googleEventId && owner) {
        await deleteGoogleEvent(owner, appointment.googleEventId);
      }

      appointment.status = "cancelled";
      await appointment.save();

      await TimeSlot.findByIdAndUpdate(appointment.timeSlotId, {
        isBooked: false,
      });

    session.cancelStep = null;
    session.cancelAppointmentId = null;
    session.cancelAppointmentOptions = [];
    resetBookingSession(session);

      botReply =
        "✅ Your appointment has been cancelled successfully. The time slot is now available again.";
    }
  } else if (lowerMsg === "no") {
    session.cancelStep = null;
    session.cancelAppointmentId = null;
    session.cancelAppointmentOptions = [];

    botReply = "No problem. Your appointment remains scheduled.";
  } else {
    botReply =
      "Please reply **yes** to cancel the appointment or **no** to keep it.";
  }
}

if (!botReply && isAppointmentCancelRequest) {
    session.forceAppointmentCancel = false;

    const activeAppointments = await Appointment.find({
    ownerId: settings.userId,
    status: { $ne: "cancelled" },
  })
    .populate("timeSlotId")
    .sort({ createdAt: -1 });

  if (!activeAppointments.length) {
    botReply =
      "I could not find an active appointment linked to this chatbot.";
  } else if (activeAppointments.length === 1) {
    const appointment = activeAppointments[0];
    const slot = appointment.timeSlotId;

    const formatted = formatAppointmentForChat(appointment, slot);

    session.cancelStep = "confirmCancel";
    session.cancelAppointmentId = appointment._id.toString();

    botReply = `I found this appointment:

${formatted}

Are you sure you want to cancel this appointment? Please reply **yes** or **no**.`;
  } else {
    session.cancelStep = "selectAppointmentToCancel";
    session.cancelAppointmentOptions = activeAppointments.map((appointment) =>
      appointment._id.toString()
    );

    const appointmentList = activeAppointments
      .map((appointment, index) => {
        const slot = appointment.timeSlotId;
        const formatted = formatAppointmentShortForChat(appointment, slot);

        return `**${index + 1}.** ${formatted}`;
      })
      .join("\n");

    botReply = `I found multiple active appointments:

${appointmentList}

Which appointment would you like to cancel? Please reply with the appointment number.`;
  }
}

  /* ===============================
     APPOINTMENT FLOW TRIGGER
  ================================ */
  const detectedBookingType = detectBookingIntent(lowerMsg);
const freshAppointmentRequest =
  detectedBookingType === "appointment" &&
  lowerMsg !== "yes" &&
  lowerMsg !== "no" &&
  lowerMsg !== "y" &&
  lowerMsg !== "n";

if (!botReply && freshAppointmentRequest) {
  resetBookingSession(session);
  session.bookingType = "appointment";
  session.appointmentStep = "confirm";
  botReply = "Do you want to schedule an online meeting or callback? (yes/no)";
}

const inAppointmentFlow =
  session.bookingType === "appointment" && session.appointmentStep !== null;
const inReservationFlow =
  session.bookingType === "reservation" && session.reservationStep !== null;
const inAnyBookingFlow = inAppointmentFlow || inReservationFlow;

const cancelRequested = isSimpleCancel || isAppointmentCancelRequest;

if (!botReply && isAppointmentRescheduleRequest) {
  session.rescheduleStep = "askPhone";
  session.rescheduleAppointmentId = null;
  session.rescheduleAppointmentOptions = [];

  botReply =
    "Sure. Please provide the phone number used for the appointment you want to reschedule.";
}

if (!botReply && !inAnyBookingFlow && detectedBookingType === "unknown") {
  session.bookingType = "clarify";
  session.bookingIntentConfirmed = false;

  botReply =
    "Sure — is this for an in-person service/reservation, or for an online meeting/callback?\n\nPlease reply with **reservation** or **meeting**.";
}

if (!botReply && session.bookingType === "clarify") {
  if (lowerMsg === "reservation") {
    session.bookingType = "reservation";
    session.reservationStep = "askDate";

    botReply =
      "Great. Please provide the reservation date in YYYY-MM-DD format.";
  } else if (lowerMsg === "meeting") {
    session.bookingType = "appointment";
    session.appointmentStep = "confirm";

    botReply =
      "Great. Do you want to schedule an online meeting or callback? (yes/no)";
  } else {
    botReply =
      "Please reply with **reservation** or **meeting** so I can guide you correctly.";
  }
}

if (!botReply && !inAnyBookingFlow && detectedBookingType === "reservation") {
  session.bookingType = "reservation";
  session.reservationStep = "askDate";

  botReply =
    "Sure, I can help with that reservation. Please provide the date in YYYY-MM-DD format.";
}

if (!botReply && !inAnyBookingFlow && detectedBookingType === "appointment") {
  session.bookingType = "appointment";
  session.appointmentStep = "confirm";

  botReply = "Do you want to schedule an online meeting or callback? (yes/no)";
}

if (!botReply && !inAnyBookingFlow && lowerMsg === "reservation") {
  session.bookingType = "reservation";
  session.reservationStep = "askDate";

  botReply =
    "Great. Please provide the reservation date in YYYY-MM-DD format.";
}

if (!botReply && !inAnyBookingFlow && lowerMsg === "meeting") {
  session.bookingType = "appointment";
  session.appointmentStep = "confirm";

  botReply = "Great. Do you want to schedule an online meeting or callback? (yes/no)";
}

if (!botReply && (session.bookingType === "reservation" || inReservationFlow)) {
  switch (session.reservationStep) {
    case "askDate":
      session.reservationDate = message.trim();
      session.reservationStep = "askTime";
      botReply = "Great. What time would you like? Please use HH:MM format, for example 19:00.";
      break;

    case "askTime":
      session.reservationTime = message.trim();
      session.reservationStep = "askPartySize";
      botReply = "How many people is the reservation for?";
      break;

    case "askPartySize":
      if (isNaN(Number(message)) || Number(message) < 1) {
        botReply = "Please enter a valid number of guests.";
        break;
      }

      session.reservationPartySize = Number(message);
      session.reservationStep = "askName";
      botReply = "Please provide the reservation name.";
      break;

    case "askName":
      session.reservationName = message.trim();
      session.reservationStep = "askPhone";
      botReply = "Please provide your phone number.";
      break;

    case "askPhone":
      session.reservationPhone = message.trim();
      session.reservationStep = "askSpecialRequest";
      botReply = "Any special requests? Type **none** if there are no special requests.";
      break;

    case "askSpecialRequest": {
      session.reservationSpecialRequest =
        lowerMsg === "none" ? "" : message.trim();

      try {
        const businessSlug =
          session.reservationBusinessSlug ||
          process.env.RESERVATION_BUSINESS_SLUG ||
          "dim-sum-dragon";

        const business = await getBusinessBySlug(businessSlug);

        const available = await checkReservationAvailability({
          businessId: business.id,
          reservationDate: session.reservationDate,
          reservationTime: session.reservationTime,
          partySize: session.reservationPartySize,
        });

        if (!available) {
          botReply =
            "Sorry, that reservation slot is fully booked. Please try another time.";
          session.reservationStep = "askTime";
          break;
        }

        const reservation = await createReservation({
          businessId: business.id,
          customerName: session.reservationName,
          phone: session.reservationPhone,
          reservationDate: session.reservationDate,
          reservationTime: session.reservationTime,
          partySize: session.reservationPartySize,
          specialRequest: session.reservationSpecialRequest,
        });

        botReply = `✅ Reservation confirmed!

**Reference:** ${reservation.reservation_reference}  
**Name:** ${reservation.customer_name}  
**Date:** ${reservation.reservation_date}  
**Time:** ${reservation.reservation_time}  
**Party size:** ${reservation.party_size}

Your reservation has been added to the reservation dashboard.`;

        resetBookingSession(session);
      } catch (err) {
        console.error("Reservation booking error:", err);

        botReply =
          "Sorry, I could not create the reservation right now. Please try again or use the reservation form.";

        resetBookingSession(session);
      }

      break;
    }

    default:
      session.bookingType = "reservation";
      session.reservationStep = "askDate";
      botReply =
        "Sure, I can help with that reservation. Please provide the date in YYYY-MM-DD format.";
      break;
  }
}

if (!botReply && (session.bookingType === "appointment" || inAppointmentFlow)) {
    switch (session.appointmentStep) {
      /* ---------------------------
         START FLOW
      ---------------------------- */
      case null:
        session.bookingType = "appointment";
        session.appointmentStep = "confirm";
        botReply = "Do you want to schedule an online meeting or callback? (yes/no)";
      break;

      /* ---------------------------
         CONFIRMATION
      ---------------------------- */
     case "confirm":
  if (lowerMsg === "yes" || lowerMsg === "y") {
    session.appointmentStep = "askDate";
    botReply = "Great! Please provide a date (YYYY-MM-DD).";
  } else if (lowerMsg === "no" || lowerMsg === "n") {
    resetBookingSession(session);
    botReply = "Okay 👍 Appointment cancelled.";
  } else {
    botReply =
      "Please reply **yes** to continue scheduling, or **no** to cancel.";
  }
  break;

      /* ---------------------------
         ASK DATE
      ---------------------------- */
      case "askDate": {
        const parsedDate = DateTime.fromISO(message, {
          zone: timeZone,
        }).startOf("day");

        const nowInUserTZ = DateTime.now().setZone(timeZone).startOf("day");

        if (!parsedDate.isValid || parsedDate < nowInUserTZ) {
          botReply =
            "❌ Please enter a valid future date in YYYY-MM-DD format.";
          break;
        }
        session.appointmentDate = message;

        const startOfDayUTC = parsedDate.startOf("day").toUTC().toJSDate();
        const endOfDayUTC = parsedDate.endOf("day").toUTC().toJSDate();

        console.log("start of ", startOfDayUTC);
        console.log("end of  ", endOfDayUTC);

        const slots = await TimeSlot.find({
          start: {
            $gte: startOfDayUTC,
            $lt: endOfDayUTC,
          },
          userId: session.userId,
          isBooked: false,
        });
        console.log(session.appointmentDate, slots);

        if (!slots.length) {
          botReply =
            "No available slots on this date. Please choose another date.";
        } else {
          session.appointmentStep = "chooseSlot";
          session.tempSlots = slots.map((s) => s._id.toString());
          const formattedSlots = slots.map((s, i) => {
            const localTime = DateTime.fromJSDate(s.start, { zone: "utc" })
              .setZone(timeZone)
              .toFormat("hh:mm a");

            return `**${i + 1}.** ${localTime}`;
          });
          botReply =
            "Here are available slots:\n\n" +
            formattedSlots.join("<br>\n") +
            "\n\nReply with the slot number.";
        }
        console.log(botReply);
        break;
      }

      /* ---------------------------
         CHOOSE SLOT
      ---------------------------- */
      case "chooseSlot": {
        const choice = parseInt(message);

        const slotId = session.tempSlots?.[choice - 1];

        if (!slotId) {
          botReply =
            "❌ Invalid choice. Please reply with a valid slot number.";
          break;
        }

        session.selectedSlot = slotId;

if (session.isRescheduling) {
  session.appointmentStep = "askPhone";
  botReply =
    "I will use your existing appointment details. Please confirm your phone number by typing it again.";
} else {
  session.appointmentStep = "askName";
  botReply = "Please provide your full name.";
}

break;
      }

      /* ---------------------------
         ASK NAME
      ---------------------------- */
      case "askName":
        session.appointmentName = message.trim();
        session.appointmentStep = "askEmail";
        botReply = "Please provide your email address.";
        break;

      /* ---------------------------
         ASK EMAIL
      ---------------------------- */
      case "askEmail":
        if (!message.includes("@")) {
          botReply = "❌ Please enter a valid email address or type 'cancel'.";
          break;
        }

        session.appointmentEmail = message.trim();
        session.appointmentStep = "askPhone";
        botReply = "Please provide your phone number.";
        break;

      /* ---------------------------
         ASK PHONE
      ---------------------------- */
      case "askPhone":
        if (message.trim().length < 8) {
          botReply = "❌ Please enter a valid phone number or type 'cancel'.";
          break;
        }

        session.appointmentPhone = message.trim();

        try {
          const slot = await TimeSlot.findById(session.selectedSlot);

          if (!slot || slot.isBooked) {
            botReply = "❌ Slot not available anymore. Please restart booking.";
            session.appointmentStep = null;
            break;
          }

          slot.isBooked = true;

          const appointment = new Appointment({
            timeSlotId: slot._id,
            ownerId: slot.userId,
            name: session.appointmentName,
            email: session.appointmentEmail,
            phone: session.appointmentPhone,
            address: message.trim(),
            clientTimeZone: timeZone,
          });

          const meeting = await createGoogleMeet({
            userId: slot.userId,
            summary: `Appointment: ${settings.brandName || settings.botName || "Business"} × ${session.appointmentName}`,
            description: `Phone: ${session.appointmentPhone}`,
            startTime: slot.start,
            endTime: slot.end,
            timeZone: slot.timeZone,
            attendeeEmail: session.appointmentEmail,
            attendeeName: session.appointmentName,
          });

          if (meeting == null) {
            throw new Error("createGoogleMeet return  null value");
          }

          appointment.meetingLink = meeting.hangoutLink;
          appointment.googleEventId = meeting.eventId;
          await slot.save();
          await appointment.save();

if (session.isRescheduling && session.rescheduleAppointmentId) {
  const oldAppointment = await Appointment.findById(
    session.rescheduleAppointmentId
  );

     if (oldAppointment && oldAppointment.status !== "cancelled") {

const owner = await User.findById(oldAppointment.ownerId);
    if (oldAppointment.googleEventId && owner) {
      await deleteGoogleEvent(owner, oldAppointment.googleEventId);
    }

    oldAppointment.status = "cancelled";
    await oldAppointment.save();

    await TimeSlot.findByIdAndUpdate(oldAppointment.timeSlotId, {
      isBooked: false,
    });
  }
}

botReply = `✅ **Appointment Confirmed!**

Great news — your appointment is now successfully booked!
Your previous appointment has been cancelled.

**Meeting Link:**  
${meeting.hangoutLink}

📩 You’ll receive a formal confirmation email with all the details shortly.

We’re looking forward to it!  
See you soon. 😊
`;

          // ✅ EXIT appointment flow properly
          session.appointmentStep = null;
          session.tempSlots = [];
          session.selectedSlot = null;
          session.isRescheduling = false;
          session.rescheduleAppointmentId = null;
          } catch (err) {
          console.error("Booking Error:", err);

          botReply =
            "❌ Error booking appointment. Please type 'appointment' to try again.";

          session.appointmentStep = null;
        }
        break;

      /* ---------------------------
         FINAL STEP: BOOK APPOINTMENT
      ---------------------------- */
    }
  }

  /* ===============================
     GEMINI FALLBACK
  ================================ */
  console.log(
  "Appointment Step:",
  session.appointmentStep,
  "Booking Type:",
  session.bookingType
);

  if (!botReply) {
    const trimmedHistory = formatGeminiHistory(chatHistory);

    const finalInstruction = `
${settings.systemInstruction}

--- FILE CONTEXT 1 ---
${settings.systemInstructionFileText1?.setFile ? settings.systemInstructionFileText1?.FileText : ""}

--- FILE CONTEXT 2 ---
${settings.systemInstructionFileText2?.setFile ? settings.systemInstructionFileText2?.FileText : ""}

--- INSTRUCTION ---
Use the above file contexts (File Context 1 and File Context 2) as supporting information while generating responses. If both are provided, consider and integrate insights from both contexts appropriately.
`;

    // const payload = {
    //   contents: [
    //     ...trimmedHistory,
    //     {
    //       role: "system",
    //       parts: [
    //         {
    //           text: `${settings.systemInstruction}\nAlways respond in ${
    //             language || "English"
    //           }.`,
    //         },
    //       ],
    //     },
    //     { role: "user", parts: [{ text: message }] },
    //   ],
    // };

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: finalInstruction,

              //               text: `${settings.systemInstruction}
              //  Always respond in ${language || "English"}.`,
            },
          ],
        },
        ...trimmedHistory,
        {
          role: "user",
          parts: [{ text: message }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    try {
      let gemini_key = settings?.geminiKey;
      let gemini_model = settings?.gemini_model;
      const data = await fetchGeminiWithRetry(
        gemini_key,
        gemini_model,
        payload
      );

      botReply =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "I couldn't generate a response.";
    } catch (err) {
      console.error("Gemini Error:", err);
      if (isPreview) botReply = err.message;
      else botReply = "⚠️ Gemini API is busy. Please try again.";
    }
  }

  /* ===============================
     SAVE CHAT LOGS
  ================================ */
  if (chatHistory.length <= 3 && !session.chatLogs.length) {
    console.log(chatHistory);
    session.chatLogs = chatHistory.map((msg) => {
      return {
        role: msg.role,
        text: msg.parts[0].text,
        timestamp: msg.timestamp,
      };
    });
    session.chatLogs.pop();
  }
  session.chatLogs.push(
    { role: "user", text: message, timestamp: new Date() },
    { role: "model", text: botReply, timestamp: new Date() }
  );

  await session.save();

  /* ===============================
     RESPONSE
  ================================ */
  res.json({
  success: true,
  reply: botReply,
  appointmentStep: session.appointmentStep,
  reservationStep: session.reservationStep,
  bookingType: session.bookingType,
  cancelStep: session.cancelStep,
});
});

export const getChatbotSettingsByKey = asyncHandler(async (req, res) => {
  const { apiKey } = req.query;

  console.log("apiKey received:", apiKey);
  console.log("origin received:", req.headers["x-origin"]);
  console.log("parent domain received:", req.headers["x-parent-domain"]);

  const settings = await ChatbotSettings.findOne({ apiKey });

  if (!settings) {
    console.log("No settings found for this API key");

    return res.status(403).json({
      success: false,
      error: "Invalid API key",
    });
  }

  console.log("Settings found:", settings._id.toString());

  res.json({ success: true, data: settings });
});

export const getApiKey = asyncHandler(async (req, res) => {
  const userId = req.userId;

  const settings = await ChatbotSettings.findOne({ userId }, { apiKey: 1 });

  if (!settings) {
    return res
      .status(404)
      .json({ success: false, message: "API key not found." });
  }

  res.json({ success: true, apiKey: settings.apiKey });
});

export const saveWebsiteInfo = asyncHandler(async (req, res) => {
  const userId = req.userId;

  let bot = await ChatbotSettings.findOne({ userId }).select("apiKey");
  const apiKey = bot.apiKey;
  const { info } = req.body;

  if (!apiKey || !info) {
    return res
      .status(400)
      .json({ success: false, message: "apiKey and info are required" });
  }

  const updated = await WebsiteInfo.findOneAndUpdate(
    { apiKey },
    { info, updatedAt: new Date() },
    { upsert: true, new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: "Website info saved successfully",
    data: updated,
  });
});

// Save or update a chatbot action
export const saveBotAction = asyncHandler(async (req, res) => {
  const userId = req.userId;

  let bot = await ChatbotSettings.findOne({ userId }).select("apiKey");
  const apiKey = bot.apiKey;
  const { intent, description, keywords, method, endpoint, params } = req.body;

  if (!apiKey || !intent || !method || !endpoint) {
    return res.status(400).json({
      success: false,
      message: "apiKey, intent, method, and endpoint are required",
    });
  }

  const action = new ChatbotAction({
    apiKey,
    intent,
    description,
    keywords: keywords || [],
    method,
    endpoint,
    params: params || [],
  });

  await action.save();

  res.json({
    success: true,
    message: "Chatbot action saved successfully",
    data: action,
  });
});

export const saveUserLog = asyncHandler(async (req, res) => {
  const userId = req.userId;

  const settings = await ChatbotSettings.findOne({ userId }, { apiKey: 1 });

  if (!settings) {
    return res
      .status(404)
      .json({ success: false, message: "API key not found." });
  }

  res.json({ success: true, apiKey: settings.apiKey });
});

export const getSession = asyncHandler(async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    // chatbot comes from middleware
    const chatbotId = req.chatbot._id;

    // Find session belonging to this chatbot
    const session = await Session.findOne({
      sessionId,
      chatbotId,
    });

    if (!session) {
      return res.status(200).json({
        message: "No session found, new session will be created",
        chatLogs: [],
        appointmentStep: undefined,
        preActivationData: {},
      });
    }

    return res.status(200).json({
      sessionId: session.sessionId,
      chatbotId: session.chatbotId,
      appointmentStep: session.appointmentStep,
      preActivationData: session.preActivationData,
      chatLogs: session.chatLogs,
      updatedAt: session.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    next(error);
  }
});

export const getUsersChatlog = asyncHandler(async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const userId = req.userId;

    if (!userId) {
      throw new Error("user Id required");
    }

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);

    const skip = (pageNumber - 1) * limitNumber;

    //  Run both queries in parallel
    const [sessions, totalCount] = await Promise.all([
      Session.find({ userId, isPreview: false })
        .sort({ createdAt: -1 }) // latest first
        .skip(skip)
        .limit(limitNumber),

      Session.countDocuments({ userId, isPreview: false }),
    ]);

    return res.status(200).json({
      success: true,
      message: "sessions fetched successfully",

      data: sessions,

      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalCount / limitNumber),
        totalRecords: totalCount,
        limit: limitNumber,
      },
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    next(error);
  }
});

function formatReservationForChat(reservation) {
  return `**Reference:** ${reservation.reservation_reference}  
**Name:** ${reservation.customer_name}  
**Phone:** ${reservation.phone}  
**Date:** ${reservation.reservation_date}  
**Time:** ${reservation.reservation_time}  
**Party size:** ${reservation.party_size}`;
}

function formatReservationShortForChat(reservation) {
  return `${reservation.reservation_reference} - ${reservation.reservation_date} at ${reservation.reservation_time} (${reservation.customer_name}, party of ${reservation.party_size})`;
}

function formatAppointmentForChat(appointment, slot) {
  let appointmentDate = "Not available";
  let appointmentTime = "Not available";
  let appointmentTimeZone =
    appointment.clientTimeZone || slot?.timeZone || "Not available";

  if (slot?.start && slot?.end) {
    const zone = appointment.clientTimeZone || slot.timeZone || "UTC";

    const startLocal = DateTime.fromJSDate(slot.start, {
      zone: "utc",
    }).setZone(zone);

    const endLocal = DateTime.fromJSDate(slot.end, {
      zone: "utc",
    }).setZone(zone);

    appointmentDate = startLocal.toFormat("LLLL dd, yyyy");
    appointmentTime = `${startLocal.toFormat("hh:mm a")} - ${endLocal.toFormat(
      "hh:mm a"
    )}`;
    appointmentTimeZone = zone;
  }

  return `**Date:** ${appointmentDate}  
**Time:** ${appointmentTime}  
**Timezone:** ${appointmentTimeZone}  

**Name:** ${appointment.name}  
**Email:** ${appointment.email}  
**Phone:** ${appointment.phone}`;
}

function formatAppointmentShortForChat(appointment, slot) {
  if (!slot?.start || !slot?.end) {
    return `${appointment.name} - time not available`;
  }

  const zone = appointment.clientTimeZone || slot.timeZone || "UTC";

  const startLocal = DateTime.fromJSDate(slot.start, {
    zone: "utc",
  }).setZone(zone);

  const endLocal = DateTime.fromJSDate(slot.end, {
    zone: "utc",
  }).setZone(zone);

  return `${startLocal.toFormat("LLLL dd, yyyy")} at ${startLocal.toFormat(
    "hh:mm a"
  )} - ${endLocal.toFormat("hh:mm a")} (${appointment.name})`;
}

function detectBookingIntent(lowerMsg) {
  const remoteMeetingKeywords = [
    "callback",
    "call back",
    "phone call",
    "sales call",
    "demo",
    "online meeting",
    "google meet",
    "zoom",
    "video call",
    "consultation call",
    "meeting",
  ];

  const reservationKeywords = [
    "reservation",
    "reserve",
    "book a table",
    "table",
    "restaurant",
    "dinner",
    "lunch",
    "haircut",
    "hairdresser",
    "salon",
    "barber",
    "physio",
    "physical therapist",
    "therapy",
    "clinic",
    "doctor",
    "dentist",
    "gp",
    "general practitioner",
    "service appointment",
    "visit",
    "in person",
    "in-person",
  ];

  const generalBookingKeywords = [
    "appointment",
    "book",
    "booking",
    "schedule",
  ];

  const hasRemoteMeetingIntent = remoteMeetingKeywords.some((word) =>
    lowerMsg.includes(word)
  );

  const hasReservationIntent = reservationKeywords.some((word) =>
    lowerMsg.includes(word)
  );

  const hasGeneralBookingIntent = generalBookingKeywords.some((word) =>
    lowerMsg.includes(word)
  );

  if (hasReservationIntent) return "reservation";
  if (hasRemoteMeetingIntent) return "appointment";
  if (hasGeneralBookingIntent) return "unknown";

  return null;
}

function resetBookingSession(session) {
  session.bookingType = null;
  session.bookingIntentConfirmed = false;

  session.appointmentStep = null;
  session.appointmentDate = null;
  session.appointmentName = null;
  session.appointmentEmail = null;
  session.appointmentPhone = null;
  session.tempSlots = [];
  session.selectedSlot = null;

  session.cancelStep = null;
  session.cancelAppointmentId = null;
  session.cancelAppointmentOptions = [];

  session.reservationStep = null;
  session.reservationDate = null;
  session.reservationTime = null;
  session.reservationName = null;
  session.reservationEmail = null;
  session.reservationPhone = null;
  session.reservationPartySize = null;
  session.reservationNotes = null;
}

function formatGeminiHistory(history) {
  return history.slice(-4).map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts?.[0]?.text || "" }],
  }));
}

export const optimizeSystemInstruction = asyncHandler(async (req, res) => {
  try {
    const { systemInstruction } = req.body;

    if (
      !systemInstruction ||
      typeof systemInstruction !== "string" ||
      systemInstruction.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "systemInstruction is required and cannot be empty",
      });
    }

    // Step 1: Count original tokens
    const originalTokens = await countTokens(systemInstruction);

    let finalSystemInstruction = systemInstruction;
    let finalTokens = originalTokens;
    let wasShortened = false;
    let action = "Polished";

    // Step 2: Always optimize using Gemini
    // If over limit → force strong shortening
    // If under limit → still do light optimization
    const needsStrongShortening = originalTokens > SAFE_SYSTEM_TOKEN_LIMIT;

    if (needsStrongShortening) {
      action = "Shortened + Optimized";
      wasShortened = true;
    }

    // Always run optimization
    finalSystemInstruction = await optimizeWithGemini(
      systemInstruction,
      SAFE_SYSTEM_TOKEN_LIMIT
    );
    finalTokens = await countTokens(finalSystemInstruction);

    // Final safety check - if still over limit (rare), we can retry with stronger prompt
    if (finalTokens > SAFE_SYSTEM_TOKEN_LIMIT) {
      console.warn(
        `Warning: Still over limit after optimization (${finalTokens}). Retrying with stronger shortening...`
      );

      const strongerPrompt = `Rewrite the system instruction to be significantly shorter while keeping all core rules and meaning. Target: under ${SAFE_SYSTEM_TOKEN_LIMIT} tokens. Be aggressive in removing redundancy but do not drop any important constraints.`;

      // You can enhance the prompt further if needed in a second call
      finalSystemInstruction = await optimizeWithGemini(
        finalSystemInstruction,
        SAFE_SYSTEM_TOKEN_LIMIT * 0.85
      ); // even stricter
      finalTokens = await countTokens(finalSystemInstruction);
    }

    res.json({
      success: true,
      originalTokens,
      finalTokens,
      wasShortened,
      action,
      systemInstruction: finalSystemInstruction,
      message: needsStrongShortening
        ? `System instruction was too long and has been shortened to fit safely under the limit.`
        : `System instruction has been polished for better clarity and effectiveness.`,
    });
  } catch (error) {
    console.error("Optimize System Instruction API Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

// Count exact tokens
async function countTokens(text) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:countTokens?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Count tokens failed: ${response.status}`);
  }

  const data = await response.json();
  console.log(data);
  return data.totalTokens;
}

// Optimize / Shorten system instruction using Gemini
async function optimizeWithGemini(
  originalText,
  targetTokens = SAFE_SYSTEM_TOKEN_LIMIT
) {
  const optimizerPrompt = `You are an expert System Prompt Optimizer.

Rewrite the following system instruction to make it **clear, concise, and well-structured** while preserving **every single rule, constraint, personality, tone, style, and important detail**.

Instructions for you:
- If the prompt is too long, shorten it intelligently without losing meaning.
- If it is already reasonable length, do light polishing: improve clarity, remove redundancy, and make it more effective.
- Never remove or weaken any important instruction.
- Keep the same level of strictness and detail.
- Use professional and clean formatting.

Target: Keep it well under ${targetTokens} tokens.

Return **ONLY** the optimized system instruction. No explanations, no quotes, no markdown.

Original system instruction:
${originalText}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: optimizerPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Low temperature for consistency
      maxOutputTokens: 65536,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Optimization failed: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}
