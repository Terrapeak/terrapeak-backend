import asyncHandler from "express-async-handler";
import crypto from "crypto";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import { decryptSecret, encryptSecret } from "../utils/secretEncryption.js";
import {
  buildFacebookAuthorizationUrl,
  buildFacebookFrontendReturnUrl,
  createFacebookOAuthState,
  exchangeFacebookAuthorizationCode,
  FacebookOAuthApiError,
  FacebookPageSubscriptionError,
  getFacebookOAuthAccountData,
  FacebookConnectionVerificationError,
  parseFacebookOAuthCallbackQuery,
  subscribeFacebookPageToWebhook,
  verifyFacebookPageConnection,
  verifyFacebookOAuthState,
} from "../services/facebookOAuthService.js";

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;

const hashNonce = (nonce) =>
  crypto.createHash("sha256").update(nonce).digest("hex");

const nonceMatches = (nonce, expectedHash) => {
  const actual = Buffer.from(hashNonce(nonce), "hex");
  const expected = Buffer.from(expectedHash || "", "hex");

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
};

const redirectToFacebookPage = (res, status, message) => {
  try {
    return res.redirect(
      buildFacebookFrontendReturnUrl({ status, message })
    );
  } catch {
    return res.status(500).json({
      success: false,
      message: "Facebook OAuth return URL is not configured.",
    });
  }
};

const getOwnerMembership = ({ userId, companyId }) =>
  CompanyMembership.findOne({
    userId,
    companyId,
    isActive: true,
    role: "owner",
  });

const getChannelState = ({ installation, config }) => {
  if (
    !installation ||
    !installation.enabled ||
    installation.status === "disabled"
  ) {
    return "not_installed";
  }

  if (config?.connectionStatus === "error") {
    return "connection_error";
  }

  if (config?.connectionStatus === "connected") {
    return "connected";
  }

  return "not_connected";
};

export const getFacebookChannel = asyncHandler(async (req, res) => {
  const membership = await CompanyMembership.findOne({
    userId: req.userId,
    isActive: true,
  });

  if (!membership) {
    return res.status(404).json({
      success: false,
      message: "No active company membership found.",
    });
  }

  const [installation, config] = await Promise.all([
    CompanyAppInstallation.findOne({
      companyId: membership.companyId,
      appSlug: "facebook",
    }),
    FacebookChannelConfig.findOne({
      companyId: membership.companyId,
    }),
  ]);

  const state = getChannelState({ installation, config });

  return res.json({
    success: true,
    channel: {
      companyId: membership.companyId,
      slug: "facebook",
      name: "Facebook Messenger",
      state,
      installed: state !== "not_installed",
      connection: {
        pageId: config?.pageId || null,
        pageName: config?.pageName || null,
        connectedAt: config?.connectedAt || null,
        lastError: config?.lastError || null,
      },
      diagnostics: {
        metaAccountConnected: Boolean(
          config?.metaUserId && config?.oauthCompletedAt
        ),
        selectedPage: config?.pageName || null,
        pageId: config?.pageId || null,
        tokenValid: config?.connectionStatus === "connected",
        oauthCompleted: Boolean(config?.oauthCompletedAt),
        webhookSubscribed: Boolean(config?.webhookSubscribed),
        webhookSubscriptionStatus:
          (config?.webhookSubscribed && "subscribed") ||
          config?.webhookSubscriptionStatus ||
          "not_subscribed",
        lastWebhookReceivedAt: config?.lastWebhookReceivedAt || null,
        lastWebhookProcessedAt: config?.lastWebhookProcessedAt || null,
        lastWebhookSenderId: config?.lastWebhookSenderId || null,
        lastWebhookEventType: config?.lastWebhookEventType || null,
      },
      wizard: {
        currentStep: config?.wizardStep || 1,
        oauthCompletedAt: config?.oauthCompletedAt || null,
        availablePages: (config?.availablePages || []).map((page) => ({
          pageId: page.pageId,
          pageName: page.pageName,
        })),
      },
    },
  });
});

export const connectFacebookChannel = asyncHandler(async (req, res) => {
  const membership = await CompanyMembership.findOne({
    userId: req.userId,
    isActive: true,
  });

  if (!membership) {
    return res.status(404).json({
      success: false,
      message: "No active company membership found.",
    });
  }

  const installation = await CompanyAppInstallation.findOne({
    companyId: membership.companyId,
    appSlug: "facebook",
    enabled: true,
    status: { $ne: "disabled" },
  });

  if (!installation) {
    return res.status(409).json({
      success: false,
      message: "Facebook must be installed and enabled before it can be connected.",
    });
  }

  const nonce = crypto.randomBytes(32).toString("base64url");
  const state = createFacebookOAuthState({
    userId: req.userId,
    companyId: membership.companyId,
    nonce,
  });
  const authorizationUrl = buildFacebookAuthorizationUrl(state);

  await FacebookChannelConfig.findOneAndUpdate(
    { companyId: membership.companyId },
    {
      $set: {
        appInstallationId: installation._id,
        connectionStatus: "connecting",
        wizardStep: 1,
        oauthCompletedAt: null,
        oauthStateNonceHash: hashNonce(nonce),
        oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_LIFETIME_MS),
        metaUserId: "",
        availablePages: [],
        grantedPermissions: [],
        webhookSubscribed: false,
        webhookSubscriptionStatus: "not_subscribed",
        lastError: "",
      },
      $setOnInsert: {
        companyId: membership.companyId,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  return res.json({
    success: true,
    authorizationUrl,
  });
});

export const handleFacebookOAuthCallback = async (req, res) => {
  let config;
  let phase = "callback parameter validation";

  try {
    const { code, state, metaError } = parseFacebookOAuthCallbackQuery(
      req.query
    );

    if (!state) {
      throw new Error("Missing OAuth state.");
    }

    phase = "signed state validation";
    const statePayload = verifyFacebookOAuthState(state);
    phase = "company access validation";
    const membership = await CompanyMembership.findOne({
      companyId: statePayload.companyId,
      userId: statePayload.userId,
      isActive: true,
    });

    if (!membership) {
      throw new Error("Company access is no longer active.");
    }

    phase = "stored state validation";
    config = await FacebookChannelConfig.findOne({
      companyId: statePayload.companyId,
    }).select("+oauthStateNonceHash");

    if (
      !config ||
      !config.oauthStateExpiresAt ||
      config.oauthStateExpiresAt.getTime() < Date.now() ||
      !nonceMatches(statePayload.nonce, config.oauthStateNonceHash)
    ) {
      throw new Error("OAuth state is invalid, expired, or already used.");
    }

    // Consume the nonce before calling Meta so the callback cannot be replayed.
    config.oauthStateNonceHash = "";
    config.oauthStateExpiresAt = null;
    await config.save();

    if (metaError) {
      throw new Error(
        metaError.description ||
          metaError.reason ||
          "Meta authorization was cancelled or denied."
      );
    }

    if (!code) {
      throw new Error("Meta did not return an authorization code.");
    }

    phase = "authorization-code exchange";
    const userAccessToken = await exchangeFacebookAuthorizationCode(code);
    phase = "Meta account and managed-Pages retrieval";
    const accountData = await getFacebookOAuthAccountData(userAccessToken);
    const availablePages = accountData.pages
      .filter((page) => page.id && page.name && page.access_token)
      .map((page) => ({
        pageId: page.id,
        pageName: page.name,
        pageAccessTokenEncrypted: encryptSecret(page.access_token),
      }));

    config.metaUserId = accountData.metaUserId || "";
    config.availablePages = availablePages;
    config.grantedPermissions = accountData.grantedPermissions;
    config.oauthCompletedAt = new Date();
    config.wizardStep = 2;
    config.connectionStatus = "not_connected";
    config.webhookSubscribed = false;
    config.webhookSubscriptionStatus = "not_subscribed";
    config.lastError = "";
    await config.save();

    return redirectToFacebookPage(res, "success");
  } catch (error) {
    if (config) {
      config.connectionStatus = "error";
      config.wizardStep = 1;
      config.lastError = "Facebook authorization could not be completed.";

      try {
        await config.save();
      } catch {
        // Preserve the original OAuth failure response.
      }
    }

    console.error("Facebook OAuth callback failed", {
      phase: error instanceof FacebookOAuthApiError ? error.phase : phase,
      message: error.message,
      status: error instanceof FacebookOAuthApiError ? error.status : undefined,
      statusText:
        error instanceof FacebookOAuthApiError ? error.statusText : undefined,
      metaError:
        error instanceof FacebookOAuthApiError ? error.metaError : undefined,
      requestContext:
        error instanceof FacebookOAuthApiError
          ? error.requestContext
          : undefined,
      callbackParameters: Object.keys(req.query || {}),
      stack: error.stack,
    });
    return redirectToFacebookPage(
      res,
      "error",
      "Facebook authorization could not be completed. Please try again."
    );
  }
};

export const selectFacebookPage = asyncHandler(async (req, res) => {
  const pageId =
    typeof req.body?.pageId === "string" ? req.body.pageId.trim() : "";
  const companyId =
    typeof req.body?.companyId === "string"
      ? req.body.companyId.trim()
      : "";

  if (!pageId || !companyId) {
    return res.status(400).json({
      success: false,
      message: "A company and Facebook Page must be selected.",
    });
  }

  const membership = await getOwnerMembership({
    userId: req.userId,
    companyId,
  });

  if (!membership) {
    return res.status(403).json({
      success: false,
      message: "Only the company owner can select a Facebook Page.",
    });
  }

  const config = await FacebookChannelConfig.findOne({
    companyId: membership.companyId,
  }).select("+availablePages.pageAccessTokenEncrypted");

  if (!config || config.wizardStep !== 2 || !config.oauthCompletedAt) {
    return res.status(409).json({
      success: false,
      message: "Complete Meta authorization before selecting a Facebook Page.",
    });
  }

  const selectedPage = config.availablePages.find(
    (page) => page.pageId === pageId
  );

  if (!selectedPage) {
    return res.status(400).json({
      success: false,
      message: "The selected Page is not available for this Meta account.",
    });
  }

  if (!selectedPage.pageAccessTokenEncrypted) {
    return res.status(409).json({
      success: false,
      message: "The temporary Page credential is unavailable. Reconnect Meta and try again.",
    });
  }

  config.pageId = selectedPage.pageId;
  config.pageName = selectedPage.pageName;
  config.pageAccessTokenEncrypted = selectedPage.pageAccessTokenEncrypted;
  config.availablePages = [];
  config.wizardStep = 3;
  config.connectionStatus = "not_connected";
  config.webhookSubscribed = false;
  config.webhookSubscriptionStatus = "not_subscribed";
  config.connectedAt = null;
  config.lastError = "";
  await config.save();

  return res.json({
    success: true,
    wizardStep: 3,
    selectedPage: {
      pageId: config.pageId,
      pageName: config.pageName,
    },
  });
});

export const verifyFacebookConnection = asyncHandler(async (req, res) => {
  const companyId =
    typeof req.body?.companyId === "string"
      ? req.body.companyId.trim()
      : "";

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "A company is required to verify the Facebook connection.",
    });
  }

  const membership = await getOwnerMembership({
    userId: req.userId,
    companyId,
  });

  if (!membership) {
    return res.status(403).json({
      success: false,
      message: "Only the company owner can verify a Facebook connection.",
    });
  }

  const config = await FacebookChannelConfig.findOne({
    companyId: membership.companyId,
  }).select("+pageAccessTokenEncrypted");

  if (
    !config ||
    ![3, 4].includes(config.wizardStep) ||
    !config.pageId ||
    !config.pageAccessTokenEncrypted
  ) {
    return res.status(409).json({
      success: false,
      message: "Select a Facebook Page before verifying the connection.",
    });
  }

  try {
    const pageAccessToken = decryptSecret(config.pageAccessTokenEncrypted);
    const verification = await verifyFacebookPageConnection({
      pageId: config.pageId,
      pageAccessToken,
    });
    const subscription = await subscribeFacebookPageToWebhook({
      pageId: config.pageId,
      pageAccessToken,
    });

    config.pageName = verification.pageName || config.pageName;
    config.connectionStatus = "connected";
    config.wizardStep = 4;
    config.webhookSubscribed = true;
    config.webhookSubscriptionStatus = "subscribed";
    config.connectedAt = new Date();
    config.disconnectedAt = null;
    config.lastError = "";
    await config.save();

    return res.json({
      success: true,
      wizardStep: 4,
      verification: {
        metaAccountConnected: true,
        pageSelected: true,
        pageAccessVerified: true,
        webhookSubscribed: true,
        subscribedFields: subscription.subscribedFields,
      },
    });
  } catch (error) {
    const subscriptionError =
      error instanceof FacebookPageSubscriptionError ||
      (error instanceof FacebookOAuthApiError &&
        error.phase?.startsWith("Page webhook subscription"));
    const message =
      error instanceof FacebookConnectionVerificationError
        ? error.message
        : subscriptionError
          ? "Facebook Page webhook subscription failed. Check the Meta app configuration and try again."
        : "Facebook connection verification failed. Please reconnect Meta and try again.";

    if (subscriptionError) {
      console.error("Facebook Page webhook subscription failed", {
        phase: error.phase,
        endpoint: error.requestContext?.endpoint,
        status: error.status,
        metaErrorType: error.metaError?.type,
        metaCode: error.metaError?.code,
        metaSubcode: error.metaError?.subcode,
        metaTraceId: error.metaError?.traceId,
      });
    }

    config.connectionStatus = "error";
    config.wizardStep = 3;
    config.webhookSubscribed = false;
    config.webhookSubscriptionStatus = subscriptionError
      ? "error"
      : "not_subscribed";
    config.connectedAt = null;
    config.lastError = message;
    await config.save();

    return res.status(422).json({
      success: false,
      message,
    });
  }
});
