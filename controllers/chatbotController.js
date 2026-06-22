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

  /* ===============================
     MESSAGE + CANCEL HANDLING
  ================================ */
  const lowerMsg = message.toLowerCase().trim();
  let botReply = null;

 // ✅ Cancel current flow or existing appointment
const isSimpleCancel =
  lowerMsg === "cancel" ||
  lowerMsg === "stop" ||
  lowerMsg === "exit";

const isAppointmentCancelRequest =
  lowerMsg.includes("cancel") &&
  (
    lowerMsg.includes("appointment") ||
    lowerMsg.includes("meeting") ||
    lowerMsg.includes("callback") ||
    lowerMsg.includes("booking") ||
    lowerMsg.includes("scheduled")
  );

const cancelRequested = isSimpleCancel || isAppointmentCancelRequest;

const isInsideBookingFlow =
  session.appointmentStep !== null ||
  session.reservationStep !== null ||
  session.bookingType === "appointment" ||
  session.bookingType === "reservation" ||
  session.bookingType === "clarify";

if (!botReply && isSimpleCancel && isInsideBookingFlow) {
  resetBookingSession(session);
  botReply = "Okay 👍 I cancelled the current booking process. How else can I help you?";
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

if (!botReply && cancelRequested) {
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
  botReply =
    "Reservation booking through the chatbot is being prepared. For now, please use the reservation form. Type **cancel** to stop.";

  // This is temporary for Phase 1.
  // In Phase 2, this section will become the real reservation flow.
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
        session.appointmentStep = "askName";

        botReply = "Please provide your full name.";
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

          botReply = `✅ **Appointment Confirmed!**

Great news — your appointment is now successfully booked!

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
