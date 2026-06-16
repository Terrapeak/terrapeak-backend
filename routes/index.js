import express from "express";
import authRoutes from "./auth.js";
import chatbotRoutes from "./chatbot.js";
import userRoutes from "./user.js";
import appointmentRoutes from "./appointment.js";
import widgetRouter from "./widget.js";
const router = express.Router();

router.use("/auth", authRoutes);
router.use("/chatbot", chatbotRoutes);
router.use("/admin/users", userRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/api", widgetRouter);

export default router;
