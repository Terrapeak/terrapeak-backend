import express from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";

import {
  getMyCompanyApps,
  getMyCompanies,
} from "../controllers/companyController.js";
import {
  connectFacebookChannel,
  getFacebookChannel,
  handleFacebookOAuthCallback,
  selectFacebookPage,
  verifyFacebookConnection,
} from "../controllers/facebookChannelController.js";

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

router.get(
  "/channels/facebook",
  isAuthenticated,
  isVerifiedUser,
  getFacebookChannel
);

router.get(
  "/channels/facebook/connect",
  isAuthenticated,
  isVerifiedUser,
  connectFacebookChannel
);

router.get(
  "/channels/facebook/oauth/callback",
  handleFacebookOAuthCallback
);

router.post(
  "/channels/facebook/select-page",
  isAuthenticated,
  isVerifiedUser,
  selectFacebookPage
);

router.post(
  "/channels/facebook/verify-connection",
  isAuthenticated,
  isVerifiedUser,
  verifyFacebookConnection
);

export default router;
