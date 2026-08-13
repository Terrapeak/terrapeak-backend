import express from "express";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import requireCompanyApp from "../middleware/requireCompanyApp.js";
import {
  acceptDigitalCloneConsent,
  getDigitalCloneProfile,
  saveDigitalCloneProfile,
} from "../controllers/digitalCloneController.js";

const router = express.Router();

router.use(
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  requireCompanyApp("digital-clone"),
);

router.get("/profile", getDigitalCloneProfile);
router.put("/profile", saveDigitalCloneProfile);
router.post("/consent", acceptDigitalCloneConsent);

export default router;
