import express from "express";
import isAuthenticated from "../middleware/isAuthenticated.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";

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
import { disconnectFacebookChannel } from "../controllers/facebookChannelDisconnectController.js";

const router = express.Router();

router.get(
  "/apps",
  isVerifiedUser,
  resolveCompanyContext,
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
  isVerifiedUser,
  resolveCompanyContext,
  getFacebookChannel
);

router.get(
  "/channels/facebook/connect",
  isVerifiedUser,
  resolveCompanyContext,
  connectFacebookChannel
);

router.get(
  "/channels/facebook/oauth/callback",
  handleFacebookOAuthCallback
);

router.post(
  "/channels/facebook/select-page",
  isVerifiedUser,
  resolveCompanyContext,
  selectFacebookPage
);

router.post(
  "/channels/facebook/verify-connection",
  isVerifiedUser,
  resolveCompanyContext,
  verifyFacebookConnection
);

router.post(
  "/channels/facebook/disconnect",
  isVerifiedUser,
  resolveCompanyContext,
  disconnectFacebookChannel
);

export default router;
