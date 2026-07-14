import express from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";

import {
  getMyCompanyApps,
  getMyCompanies,
} from "../controllers/companyController.js";

const router = express.Router();

router.get(
  "/apps",
  isAuthenticated,
  isVerifiedUser,
  getMyCompanyApps
);

router.get(
  "/my-companies",
  isAuthenticated,
  isVerifiedUser,
  getMyCompanies
);

export default router;