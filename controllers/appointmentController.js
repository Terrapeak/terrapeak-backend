import asyncHandler from "express-async-handler";
import ChatbotSettings from "../models/chatbotSettings.js";
import User from "../models/user.js";
import TimeSlot from "../models/timeSlot.js";
import Appointment from "../models/appointment.js";
import sendEmail from "../utils/sendEmail.js";
import mongoose from "mongoose";
import {
  oauth2Client,
  deleteGoogleEvent,
  createGoogleMeet,
} from "../utils/googleMeet.js";
import { DateTime } from "luxon";
import { configDotenv } from "dotenv";
import moment from "moment-timezone";

configDotenv();

export const getUserCalenderConn = asyncHandler(async (req, res, next) => {
  try {
    const userId = req.userId;

    const result = await User.findById(userId);

    if (!result?.isGoogleOauth) {
      return res.status(200).json({
        success: false,
        message:
          "Please enable Google Calendar access so we can align your schedules.",
        isConnected: false,
      });
    }
    return res.status(200).json({
      success: true,
      message: "google calender is connect",
      isConnected: true,
    });
  } catch (err) {
    console.log("error while fetching  google calender access", err);
    next(err);
  }
});

export const disconnectGoogleCalendar = asyncHandler(async (req, res, next) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);

    if (!user || !user.isGoogleOauth) {
      return res.status(400).json({
        success: false,
        message: "Google Calendar is not connected",
      });
    }

    try {
      // 🔥 Revoke token from Google
      if (user.googleAccessToken) {
        await oauth2Client.revokeToken(user.googleAccessToken);
      }
    } catch (revokeError) {
      console.log("Error revoking Google token:", revokeError.message);
      // Even if revoke fails, continue clearing DB
    }

    // ✅ Clear tokens from DB
    user.isGoogleOauth = false;
    user.googleAccessToken = undefined;
    user.googleRefreshToken = undefined;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Google Calendar disconnected successfully",
    });
  } catch (error) {
    console.log("Error while disconnecting Google Calendar:", error);
    next(error);
  }
});

// Get Google OAuth URL for user
// export const getGoogleAuthUrlController = asyncHandler(async (req, res) => {
//   try {
//     const user = req.user;

//     if (user.isGoogleOauth) {
//       return res
//         .status(400)
//         .json({ success: false, message: "user allready authorize" });
//     }
//     console.log(req.userId);
//     const url = oauth2Client.generateAuthUrl({
//       access_type: "offline",
//       prompt: "consent",
//       scope: ["https://www.googleapis.com/auth/calendar"],
//       state: req.userId.toString(),
//     });

//     // res.redirect(url);
//     return res
//       .status(200)
//       .json({ success: true, message: "url created successfully", url });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ message: "something went wrong" });
//   }
// });

// getGoogleAuthUrlController – prevent generating URL if already connected
export const getGoogleAuthUrlController = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select("isGoogleOauth");

  if (user?.isGoogleOauth) {
    return res.status(400).json({
      success: false,
      message: "Google Calendar is already connected",
    });
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"], // ← narrower & better
    state: req.userId.toString(),
  });
  console.log("Auth URL:", url);

  return res.status(200).json({
    success: true,
    url,
  });
});

// Exchange Google code for tokens and save them (per user)
export const exchangeGoogleCode = asyncHandler(async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      throw Object.assign(new Error("Google authorization code is required"), {
        status: 400,
      });
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens || !tokens.access_token) {
      throw Object.assign(new Error("Failed to exchange code for tokens"), {
        status: 400,
      });
    }

    const user = await User.findById(state);

    if (!user) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }

    const { access_token, refresh_token } = tokens;

    user.isGoogleOauth = true;
    user.googleAccessToken = access_token;

    if (refresh_token) {
      user.googleRefreshToken = refresh_token;
    }

    await user.save();

    const successMessage = encodeURIComponent(
      "Google Calendar connected successfully"
    );

    res.redirect(
      `${process.env.FRONTEND_URL}/dashboard/appointment?status=true&message=${successMessage}`
    );
  } catch (error) {
    console.log("TOKEN ERROR:", error.response?.data || error);

    // 🔥 Extract dynamic Google error message safely
    const googleMessage =
      error.response?.data?.error_description ||
      error.response?.data?.error ||
      error.message ||
      "Google authentication failed";

    const encodedMessage = encodeURIComponent(googleMessage);

    res.redirect(
      `${process.env.FRONTEND_URL}/dashboard/appointment?status=false&message=${encodedMessage}`
    );
  }
});

// // Save Google API key (kept for other potential uses, e.g., non-OAuth APIs)
export const saveGoogleApiKey = asyncHandler(async (req, res) => {
  try {
    const { googleApiKey } = req.body;
    if (!googleApiKey)
      throw Object.assign(new Error("Google API key is required"), {
        status: 400,
      });

    let settings = await ChatbotSettings.findOne({ userId: req.userId });
    if (!settings) {
      settings = new ChatbotSettings({ userId: req.userId });
    }

    settings.googleApiKey = googleApiKey;
    await settings.save();

    res.json({ message: "Google API key saved successfully" });
  } catch (error) {
    console.log(error);
    res
      .status(error.status || 500)
      .json({ message: error.message || "something went wrong" });
  }
});

export const createTimeSlot = asyncHandler(async (req, res, next) => {
  try {
    const {
      type, // "single" | "continuous" | "range"
      date,
      startTime,
      endTime,
      startDate,
      selectedDates,
      duration,
      timeZone,
    } = req.body;

    if (!timeZone) {
      throw Object.assign(new Error("timezone required"), {
        status: 400,
      });
    }

    //  COMMON FUNCTION: overlap check
    const isOverlapping = async (start, end) => {
      return await TimeSlot.findOne({
        userId: req.userId,
        start: { $lt: end.toJSDate() },
        end: { $gt: start.toJSDate() },
      });
    };

    // SINGLE SLOT (unchanged)
    if (type === "single") {
      if (!date || !startTime) {
        throw Object.assign(new Error("Date & startTime required"), {
          status: 400,
        });
      }

      const localStart = DateTime.fromISO(`${date}T${startTime}`, {
        zone: timeZone,
      });

      if (!localStart.isValid) {
        throw Object.assign(new Error("Invalid date/time"), {
          status: 400,
        });
      }

      const utcStart = localStart.toUTC();
      const utcEnd = utcStart.plus({ minutes: Number(duration) });

      if (utcStart < DateTime.utc()) {
        throw Object.assign(new Error("Cannot create slot in past"), {
          status: 400,
        });
      }

      const overlap = await isOverlapping(utcStart, utcEnd);
      if (overlap) {
        throw Object.assign(new Error("Time slot overlaps"), {
          status: 409,
        });
      }

      const slot = await TimeSlot.create({
        userId: req.userId,
        start: utcStart.toJSDate(),
        end: utcEnd.toJSDate(),
        timeZone,
      });

      return res.status(201).json({
        message: "Single slot created",
        slot,
      });
    }

    if (type === "continuous") {
      console.log("continue call ");

      if (!date) {
        throw Object.assign(new Error("Date  required"), {
          status: 400,
        });
      }

      const nowUTC = DateTime.utc();

      //  FIX: get day range (IMPORTANT)
      const dayStart = DateTime.fromISO(date, { zone: timeZone })
        .startOf("day")
        .toUTC();

      const dayEnd = DateTime.fromISO(date, { zone: timeZone })
        .endOf("day")
        .toUTC();

      // find last slot ONLY for that date
      const lastSlot = await TimeSlot.findOne({
        userId: req.userId,
        start: {
          $gte: dayStart.toJSDate(),
          $lte: dayEnd.toJSDate(),
        },
      }).sort({ end: -1 });

      let utcStart;

      if (lastSlot) {
        // continue from last slot of SAME DAY
        let lastEndUTC = DateTime.fromJSDate(lastSlot.end);

        if (lastEndUTC > nowUTC) {
          utcStart = lastEndUTC;
        } else {
          utcStart = nowUTC;
        }
      } else {
        const defaultStart = DateTime.fromISO(`${date}T09:00`, {
          zone: timeZone,
        }).toUTC();

        // If 9 AM is future → use it
        if (defaultStart < nowUTC) {
          utcStart = nowUTC;
        } else {
          const defaultStart = DateTime.fromISO(`${date}T09:00`, {
            zone: timeZone,
          }).toUTC();

          if (defaultStart > nowUTC) {
            utcStart = defaultStart;
          } else {
            utcStart = nowUTC;
          }
        }
      }

      const utcEnd = utcStart.plus({ minutes: Number(30) });

      // ✅ FIX: prevent crossing to next day
      if (utcEnd > dayEnd) {
        throw Object.assign(new Error("Slot exceeds day limit"), {
          status: 400,
        });
      }

      const overlap = await isOverlapping(utcStart, utcEnd);
      if (overlap) {
        throw Object.assign(new Error("Next slot overlaps"), {
          status: 409,
        });
      }

      const slot = await TimeSlot.create({
        userId: req.userId,
        start: utcStart.toJSDate(),
        end: utcEnd.toJSDate(),
        timeZone,
      });

      return res.status(201).json({
        message: "Continuous slot created",
        slot,
      });
    }

    if (type === "range") {
      let overlappedSlots = [];
      const { startDate, selectedDates, timeZone } = req.body;

      if (!startDate || !selectedDates?.length) {
        throw Object.assign(new Error("startDate and selectedDates required"), {
          status: 400,
        });
      }

      let created = 0;
      let skipped = 0;

      // STEP 1: Get base day range
      const baseStart = DateTime.fromISO(startDate, { zone: timeZone })
        .startOf("day")
        .toUTC();

      const baseEnd = DateTime.fromISO(startDate, { zone: timeZone })
        .endOf("day")
        .toUTC();

      // STEP 2: Fetch base slots
      const baseSlots = await TimeSlot.find({
        userId: req.userId,
        start: {
          $gte: baseStart.toJSDate(),
          $lte: baseEnd.toJSDate(),
        },
      });

      if (!baseSlots.length) {
        throw Object.assign(new Error("No slots found for base date"), {
          status: 400,
        });
      }

      // STEP 3: Loop only selected dates
      for (const date of selectedDates) {
        for (const slot of baseSlots) {
          // this utc to ist
          const baseStartTime = DateTime.fromJSDate(slot.start).setZone(
            timeZone
          );

          // this utc to ist
          const baseEndTime = DateTime.fromJSDate(slot.end).setZone(timeZone);

          const newStart = DateTime.fromISO(date, { zone: timeZone })
            .set({
              hour: baseStartTime.hour,
              minute: baseStartTime.minute,
              second: 0,
              millisecond: 0,
            })
            .toUTC();

          const newEnd = DateTime.fromISO(date, { zone: timeZone })
            .set({
              hour: baseEndTime.hour,
              minute: baseEndTime.minute,
              second: 0,
              millisecond: 0,
            })
            .toUTC();

          //  skip past
          if (newStart < DateTime.utc()) {
            skipped++;
            continue;
          }

          // overlap check
          const overlap = await isOverlapping(newStart, newEnd);

          if (overlap) {
            skipped++;
            // let overlappedslot =
            //   DateTime.fromJSDate(newStart).setZone(timeZone);

            const overlappedslot = newStart.setZone(timeZone);

            overlappedSlots.push(overlappedslot);
          } else {
            await TimeSlot.create({
              userId: req.userId,
              start: newStart.toJSDate(),
              end: newEnd.toJSDate(),
              timeZone,
            });
            created++;
          }
        }
      }

      return res.status(201).json({
        message: "Slots copied to selected dates",
        created,
        skipped,
        overlappedSlots,
      });
    }

    throw Object.assign(new Error("Invalid type"), { status: 400 });
  } catch (err) {
    next(err);
  }
});

export const updateTimeSlot = asyncHandler(async (req, res, next) => {
  try {
    const { timeSlotId } = req.params;
    const { date, startTime, duration, timeZone } = req.body;

    if (!timeSlotId)
      throw Object.assign(new Error("timeSlotId is required"), { status: 400 });

    const timeSlot = await TimeSlot.findById(timeSlotId);

    if (!timeSlot)
      throw Object.assign(new Error("TimeSlot not found"), { status: 404 });

    if (req.userId.toString() !== timeSlot.userId.toString())
      throw Object.assign(new Error("Not authorized"), { status: 403 });

    if (timeSlot.isBooked)
      throw Object.assign(new Error("Cannot update. Slot already booked."), {
        status: 400,
      });

    if (!date || !startTime || !duration || !timeZone)
      throw Object.assign(
        new Error("date, startTime, duration, timeZone required"),
        { status: 400 }
      );

    // 1️⃣ Create local time
    const localStart = DateTime.fromISO(`${date}T${startTime}`, {
      zone: timeZone,
    });

    if (!localStart.isValid)
      throw Object.assign(new Error("Invalid date/time"), { status: 400 });

    const utcStart = localStart.toUTC();
    const utcEnd = utcStart.plus({ minutes: Number(duration) });

    // 2️⃣ Check overlap
    const overlapping = await TimeSlot.findOne({
      userId: req.userId,
      _id: { $ne: timeSlotId },
      start: { $lt: utcEnd.toJSDate() },
      end: { $gt: utcStart.toJSDate() },
    });

    if (overlapping)
      throw Object.assign(new Error("Time slot overlaps"), { status: 409 });

    // 3️⃣ Save
    timeSlot.start = utcStart.toJSDate();
    timeSlot.end = utcEnd.toJSDate();
    timeSlot.timeZone = timeZone;

    await timeSlot.save();

    res.status(200).json({
      message: "Time slot updated successfully",
      timeSlot,
    });
  } catch (err) {
    next(err);
  }
});

export const deleteTimeSlot = asyncHandler(async (req, res, next) => {
  try {
    const { timeSlotId } = req.params;

    if (!timeSlotId)
      throw Object.assign(new Error("timeSlotId required"), { status: 400 });

    const timeSlot = await TimeSlot.findById(timeSlotId);

    if (!timeSlot)
      throw Object.assign(new Error("TimeSlot not found"), { status: 404 });

    if (req.userId.toString() !== timeSlot.userId.toString())
      throw Object.assign(new Error("Not authorized"), { status: 403 });

    if (timeSlot.isBooked)
      throw Object.assign(new Error("Cannot delete. Slot already booked."), {
        status: 400,
      });

    await timeSlot.deleteOne();

    res.status(200).json({
      message: "Time slot deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

export const getTimeSlots = asyncHandler(async (req, res, next) => {
  try {
    const userId = req.userId;
    const { timeZone, date } = req.query;

    if (!timeZone)
      throw Object.assign(new Error("timeZone required"), { status: 400 });

    let query = { userId };

    //  If date is provided → filter by that day
    if (date) {
      const startOfDay = DateTime.fromISO(date, { zone: timeZone })
        .startOf("day")
        .toUTC();

      const endOfDay = DateTime.fromISO(date, { zone: timeZone })
        .endOf("day")
        .toUTC();

      query.start = {
        $gte: startOfDay.toJSDate(),
        $lte: endOfDay.toJSDate(),
      };
    } else {
      const today = DateTime.now().setZone(timeZone).startOf("day").toUTC();
      query.start = {
        $gte: today.toJSDate(),
      };
    }

    //  Fetch slots (with or without date filter)
    const slots = await TimeSlot.find(query).sort({ start: 1 });

    //  Convert back to viewer timezone
    const formattedSlots = slots.map((slot) => {
      const localStart = DateTime.fromJSDate(slot.start, {
        zone: "utc",
      }).setZone(timeZone);

      const localEnd = DateTime.fromJSDate(slot.end, {
        zone: "utc",
      }).setZone(timeZone);

      return {
        _id: slot._id,
        start: localStart.toFormat("yyyy-MM-dd HH:mm"),
        end: localEnd.toFormat("yyyy-MM-dd HH:mm"),
        isBooked: slot.isBooked,
      };
    });

    res.status(200).json({
      success: true,
      count: formattedSlots.length,
      slots: formattedSlots,
    });
  } catch (err) {
    next(err);
  }
});

// Get availability
// export const getAvailibility = asyncHandler(async (req, res) => {
//   try {
//     const chatBotId = req.params.chatBotId;
//     console.log("chatbot id is", chatBotId);

//     const chatbot = await ChatbotSettings.findById(chatBotId);
//     const userId = req.userId || chatbot.userId;
//     const { date } = req.query;

//     const query = { userId, isBooked: false };
//     if (date) {
//       const startOfDay = new Date(date);
//       startOfDay.setHours(0, 0, 0, 0);
//       const endOfDay = new Date(date);
//       endOfDay.setHours(23, 59, 59, 999);
//       query.date = { $gte: startOfDay, $lte: endOfDay };
//     }

//     const timeSlots = await TimeSlot.find(query)
//       .populate("userId", "name email")
//       .sort({ date: 1, startTime: 1 });

//     res.json({ count: timeSlots.length, timeSlots });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ message: "something went wrong.." });
//   }
// });

// Book appointment (guest booking allowed)

// export const bookAppointment = asyncHandler(async (req, res, next) => {
//   try {
//     const { timeSlotId, name, email, phone, address } = req.body;

//     if (!name || !email || !phone || !address) {
//       throw Object.assign(new Error("All fields are required"), {
//         status: 400,
//       });
//     }

//     const slot = await TimeSlot.findById(timeSlotId);

//     if (!slot || slot.isBooked) {
//       throw Object.assign(new Error("Allready booked"), {
//         status: 400,
//       });
//     }

//     slot.isBooked = true;

//     const appointment = new Appointment({
//       timeSlotId: slot._id,
//       ownerId: slot.userId,
//       name: name,
//       email: email,
//       phone: phone,
//       address: address.trim(),
//     });
//     const { start, end } = buildSlotDateTime(slot);

//     const meeting = await createGoogleMeet({
//       userId: slot.userId,
//       summary: `Appointment with ${name}`,
//       description: `Phone: ${phone}`,
//       startTime: start,
//       endTime: end,
//     });

//     if (meeting == null) {
//       throw Error("createGoogleMeet return  null value");
//     }

//     appointment.meetingLink = meeting.hangoutLink;
//     appointment.googleEventId = meeting.eventId;
//     await slot.save();
//     await appointment.save();

//     res.status(200).json({ meeting });
//   } catch (err) {
//     console.error("Booking Error:", err);
//     next(err);
//   }
// });

// Cancel appointment
// export const CancelAppointment = asyncHandler(async (req, res, next) => {
//   try {
//     const appointment = await Appointment.findById(req.params.appointmentId)
//       .populate("timeSlotId")
//       .populate("ownerId")
//       .exec();

//     if (!appointment)
//       throw Object.assign(new Error("Appointment not found"), { status: 404 });

//     if (appointment.ownerId._id.toString() !== req.userId.toString())
//       throw Object.assign(new Error("Not authorized"), { status: 403 });

//     // if (appointment.status !== "pending")
//     //   throw Object.assign(
//     //     new Error("only pending appointment are allow to confirm"),
//     //     { status: 400 }
//     //   );

//     // 1️ Delete Google Calendar event if exists
//     if (appointment.googleEventId && appointment.ownerId.isGoogleOauth) {
//       await deleteGoogleEvent(appointment.ownerId, appointment.googleEventId);
//     } else {
//       return res.status(400).json({
//         success: false,
//         message: "error while  deleting event form calender",
//       });
//     }

//     // 2️ Release slot
//     if (appointment.timeSlotId) {
//       appointment.timeSlotId.isBooked = false;
//       await appointment.timeSlotId.save();
//     }

//     // 3️ cancelled  appointment document
//     appointment.status = "cancelled";
//     appointment.meetingLink = null;
//     await appointment.save();

//     // 4️ Send email
//     sendEmail({
//       to: appointment.email,
//       subject: "Your Appointment has been Cancelled ❌",
//       text: `Hello ${appointment.name},\n\nYour appointment has been cancelled.\n\nThanks.`,
//     })
//       .then((res) =>
//         console.log(`appointment cancelled email send successfully`)
//       )
//       .catch((err) => console.log(`error while sending cancelled mail ${err}`));

//     res.json({ message: "Appointment cancelled successfully" });
//   } catch (error) {
//     next(error);
//   }
// });

export const CancelAppointment = asyncHandler(async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.appointmentId)
      .populate("timeSlotId")
      .populate("ownerId", "name email companyName isGoogleOauth") // Populate isGoogleOauth as well
      .exec();

    if (!appointment)
      throw Object.assign(new Error("Appointment not found"), { status: 404 });

    // Only the slot owner can cancel
    if (appointment.ownerId._id.toString() !== req.userId.toString())
      throw Object.assign(new Error("Not authorized"), { status: 403 });

    console.log("appoint ment ", appointment);

    // Get the start and end times from the timeSlotId
    const startTime = appointment.timeSlotId.start; // Assuming startTime is a Date object
    const endTime = appointment.timeSlotId.end; // Assuming endTime is a Date object

    // Convert to the client's time zone
    const clientStartTime = moment(startTime).tz(appointment.clientTimeZone);
    const clientEndTime = moment(endTime).tz(appointment.clientTimeZone);

    // Format the date and time for the email
    const formattedDate = clientStartTime.format("LL"); // e.g., "September 1, 2023"
    const formattedStartTime = clientStartTime.format("LT"); // e.g., "10:30 AM"
    const formattedEndTime = clientEndTime.format("LT"); // e.g., "11:00 AM"
    const timeZoneAbbreviation = clientStartTime.format("z"); // e.g., "PDT"

    // 1️ Delete Google Calendar event if exists
    // Ensure you're checking both googleEventId and if the owner has Google OAuth enabled
    if (appointment.googleEventId && appointment.ownerId.isGoogleOauth) {
      await deleteGoogleEvent(appointment.ownerId, appointment.googleEventId);
    }
    // Removed the else block returning 400. If there's no google event, it just means
    // there's nothing to delete on Google Calendar, which is not an error for cancellation.

    // 2️ Release slot
    if (appointment.timeSlotId) {
      appointment.timeSlotId.isBooked = false;
      await appointment.timeSlotId.save();
    }

    // 3️ cancelled appointment document
    appointment.status = "cancelled";
    appointment.meetingLink = null; // Explicitly set to null if it wasn't already
    await appointment.save();

    // 4️ Send email
    sendEmail({
      to: appointment.email,
      subject: "Your Appointment has been Cancelled ❌",
      text: `Hello ${appointment.name},\n\nYour appointment with ${appointment.ownerId.companyName || appointment.ownerId.name} scheduled for ${formattedDate} from ${formattedStartTime} to ${formattedEndTime} (${timeZoneAbbreviation}) has been cancelled.\n\nWe apologize for any inconvenience.\n\nThanks.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #DC3545; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">Appointment Cancelled</h2>
          </div>
          <div style="padding: 30px;">
            <p>Hello <b>${appointment.name}</b>,</p>
            <p>We regret to inform you that your appointment with <b>${appointment.ownerId.name || appointment.ownerId.companyName}</b> has been <span style="color: #DC3545; font-weight: bold;">cancelled</span>.</p>
            
            <p style="font-size: 1.1em; font-weight: bold; margin-bottom: 15px;">Cancelled Appointment Details:</p>
            <ul style="list-style: none; padding: 0; margin-bottom: 20px;">
              <li style="margin-bottom: 10px;"><strong>Date:</strong> ${formattedDate}</li>
              <li style="margin-bottom: 10px;"><strong>Time:</strong> ${formattedStartTime} - ${formattedEndTime} (${timeZoneAbbreviation})</li>
            </ul>

            <p>We apologize for any inconvenience this may cause.</p>
            <p>If you have any questions, or would like to reschedule, please feel free to contact us.</p>
            
            <p style="margin-top: 30px;">Sincerely,<br/>
            <b>${appointment.ownerId.name || appointment.ownerId.companyName}</b><br/>
            ${process.env.APP_NAME}</p>
          </div>
          <div style="background-color: #f8f8f8; color: #555; padding: 15px; text-align: center; font-size: 0.9em; border-top: 1px solid #e0e0e0;">
            This is an automated email.
          </div>
        </div>
      `,
    })
      .then((res) =>
        console.log(`appointment cancelled email send successfully`)
      )
      .catch((err) => console.log(`error while sending cancelled mail ${err}`));

    res.json({ message: "Appointment cancelled successfully" });
  } catch (error) {
    next(error);
  }
});

// // Confirm appointment
// export const ConfirmAppointment = asyncHandler(async (req, res, next) => {
//   try {
//     const appointment = await Appointment.findById(req.params.appointmentId)
//       .populate("timeSlotId")
//       .populate("ownerId", "name email companyName")
//       .exec();

//     if (!appointment)
//       throw Object.assign(new Error("Appointment not found"), { status: 404 });

//     // Only the slot owner can confirm
//     if (appointment.ownerId._id.toString() !== req.userId.toString()) {
//       throw Object.assign(new Error("Not authorized"), { status: 403 });
//     }
//     if (appointment.status !== "pending")
//       throw Object.assign(
//         new Error("only pending appointment are allow to confirm"),
//         { status: 400 }
//       );
//     // Update status
//     appointment.status = "confirmed";
//     await appointment.save();

//     console.log("appoiont ment ", appointment);

//     // Send confirmation email to guest
//     sendEmail({
//       to: appointment.email,
//       subject: "Your Appointment is Confirmed ✅",
//       text: `Hello ${appointment.name},\n\nYour appointment with ${appointment.ownerId.companyName || appointment.ownerId.name} has been confirmed.\nMeeting link: ${appointment.meetingLink}\n\nThanks!`,
//       html: `
//         <p>Hello <b>${appointment.name}</b>,</p>
//         <p>Your appointment with <b>${appointment.ownerId.name}</b> has been <span style="color:green;">confirmed</span>.</p>
//         <p><b>Meeting Link:</b> <a href="${appointment.meetingLink}">${appointment.meetingLink}</a></p>
//         <p>Thanks,<br/>${process.env.APP_NAME}</p>
//       `,
//     })
//       .then((res) =>
//         console.log(`appointment confirtmation email send successfully`)
//       )
//       .catch((err) =>
//         console.log(`error while sending confirmation mail ${err}`)
//       );

//     res.status(200).json({ message: "Appointment confirmed", appointment });
//   } catch (error) {
//     next(error);
//   }
// });

export const ConfirmAppointment = asyncHandler(async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.appointmentId)
      .populate("timeSlotId")
      .populate("ownerId", "name email companyName")
      .exec();

    if (!appointment)
      throw Object.assign(new Error("Appointment not found"), { status: 404 });

    // Only the slot owner can confirm
    if (appointment.ownerId._id.toString() !== req.userId.toString()) {
      throw Object.assign(new Error("Not authorized"), { status: 403 });
    }
    if (appointment.status !== "pending")
      throw Object.assign(
        new Error("only pending appointment are allow to confirm"),
        { status: 400 }
      );

    // Get the start and end times from the timeSlotId
    const startTime = appointment.timeSlotId.start; // Assuming startTime is a Date object
    const endTime = appointment.timeSlotId.end; // Assuming endTime is a Date object

    console.log("appointment ", appointment);

    // Convert to the client's time zone
    const clientStartTime = moment(startTime).tz(appointment.clientTimeZone);
    const clientEndTime = moment(endTime).tz(appointment.clientTimeZone);

    // Format the date and time for the email
    const formattedDate = clientStartTime.format("LL"); // e.g., "September 1, 2023"
    const formattedStartTime = clientStartTime.format("LT"); // e.g., "10:30 AM"
    const formattedEndTime = clientEndTime.format("LT"); // e.g., "11:00 AM"
    const timeZoneAbbreviation = clientStartTime.format("z"); // e.g., "PDT"

    // Update status
    appointment.status = "confirmed";
    await appointment.save();

    console.log("appoiont ment ", appointment);

    // Send confirmation email to guest
    sendEmail({
      to: appointment.email,
      subject: "Your Appointment is Confirmed ✅",
      // Text version of the email
      text: `Hello ${appointment.name},\n\nYour appointment with ${appointment.ownerId.companyName || appointment.ownerId.name} has been confirmed.\n\nDetails:\nDate: ${formattedDate}\nTime: ${formattedStartTime} - ${formattedEndTime} (${timeZoneAbbreviation})\nMeeting link: ${appointment.meetingLink}\n\nThanks!`,
      // HTML version of the email for a more professional look
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">Appointment Confirmed!</h2>
          </div>
          <div style="padding: 30px;">
            <p>Hello <b>${appointment.name}</b>,</p>
            <p>Your appointment with <b>${appointment.ownerId.name || appointment.ownerId.companyName}</b> has been successfully <span style="color: green; font-weight: bold;">confirmed</span>.</p>
            
            <p style="font-size: 1.1em; font-weight: bold; margin-bottom: 15px;">Appointment Details:</p>
            <ul style="list-style: none; padding: 0; margin-bottom: 20px;">
              <li style="margin-bottom: 10px;"><strong>Date:</strong> ${formattedDate}</li>
              <li style="margin-bottom: 10px;"><strong>Time:</strong> ${formattedStartTime} - ${formattedEndTime} (${timeZoneAbbreviation})</li>
              <li style="margin-bottom: 10px;"><strong>Meeting Link:</strong> <a href="${appointment.meetingLink}" style="color: #007BFF; text-decoration: none;">${appointment.meetingLink}</a></li>
            </ul>

            <p>We look forward to meeting with you.</p>
            <p>If you have any questions, please don't hesitate to reach out.</p>
            
            <p style="margin-top: 30px;">Thanks & Regards,<br/>
            <b>${appointment.ownerId.name || appointment.ownerId.companyName}</b><br/>
            ${process.env.APP_NAME}</p>
          </div>
          <div style="background-color: #f8f8f8; color: #555; padding: 15px; text-align: center; font-size: 0.9em; border-top: 1px solid #e0e0e0;">
            This is an automated email, please do not reply directly to this message.
          </div>
        </div>
      `,
    })
      .then((res) =>
        console.log(`appointment confirtmation email send successfully`)
      )
      .catch((err) =>
        console.log(`error while sending confirmation mail ${err}`)
      );

    res.status(200).json({ message: "Appointment confirmed", appointment });
  } catch (error) {
    next(error);
  }
});

// Get appointments (only for owners now)

export const getAppointments = asyncHandler(async (req, res, next) => {
  try {
    const userId = req.userId;

    const { timeZone, date } = req.query;

    if (!timeZone) {
      return res.status(400).json({
        success: false,
        message: "Timezone is required",
      });
    }
    console.log(timeZone, "dfaq");
    let dateFilter = {};

    //  Apply date filter only if date exists
    if (date) {
      const startOfDayUTC = DateTime.fromISO(date, { zone: timeZone })
        .startOf("day")
        .toUTC()
        .toJSDate();

      const endOfDayUTC = DateTime.fromISO(date, { zone: timeZone })
        .endOf("day")
        .toUTC()
        .toJSDate();

      dateFilter = {
        "timeSlot.start": {
          $gte: startOfDayUTC,
          $lte: endOfDayUTC,
        },
      };
    } else {
      const today = DateTime.now().setZone(timeZone).startOf("day").toUTC();
      dateFilter = {
        "timeSlot.start": {
          $gte: today,
        },
      };
    }

    const appointments = await Appointment.aggregate([
      {
        $match: {
          ownerId: new mongoose.Types.ObjectId(userId),
        },
      },
      {
        $lookup: {
          from: "timeslots",
          localField: "timeSlotId",
          foreignField: "_id",
          as: "timeSlot",
        },
      },
      {
        $unwind: {
          path: "$timeSlot",
        },
      },

      //  Apply dynamic filter
      ...(date ? [{ $match: dateFilter }] : []),
    ]);
    console.log(appointments);
    return res.status(200).json({
      success: true,
      count: appointments.length,
      appointments,
    });
  } catch (err) {
    next(err);
  }
});
