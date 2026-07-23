import express from "express";
import authRoutes from "./auth.js";
import chatbotRoutes from "./chatbot.js";
import userRoutes from "./user.js";
import appointmentRoutes from "./appointment.js";
import companyRoutes from "./company.js";
import platformAdminRoutes from "./platformAdmin.js";
import supportRoutes from "./support.js";
import widgetRouter from "./widget.js";
import facebookRoutes from "./facebook.js";
import organizationRoutes from "./organizations.js";
import platformOrganizationRoutes from "./platformOrganizations.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/chatbot", chatbotRoutes);
router.use("/admin/users", userRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/company", companyRoutes);
router.use("/platform-admin", platformAdminRoutes);
router.use("/platform/organizations", platformOrganizationRoutes);
router.use("/organizations", organizationRoutes);
router.use("/support", supportRoutes);
router.use("/api", widgetRouter);
router.use("/facebook", facebookRoutes);

export default router;
