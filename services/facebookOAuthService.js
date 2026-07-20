import axios from "axios";
import jwt from "jsonwebtoken";

const STATE_ISSUER = "terrapeak";
const STATE_AUDIENCE = "facebook-channel-oauth";
const DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
];

const requireEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
};

const getMetaConfig = () => {
  const graphVersion = requireEnvironmentVariable("META_GRAPH_API_VERSION");

  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("META_GRAPH_API_VERSION must use a value such as v24.0.");
  }

  return {
    appId: requireEnvironmentVariable("META_APP_ID"),
    appSecret: requireEnvironmentVariable("META_APP_SECRET"),
    graphVersion,
    redirectUri: requireEnvironmentVariable("META_OAUTH_REDIRECT_URI"),
    scopes: process.env.META_OAUTH_SCOPES
      ? process.env.META_OAUTH_SCOPES.split(",")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : DEFAULT_SCOPES,
  };
};

export const createFacebookOAuthState = ({ userId, companyId, nonce }) =>
  jwt.sign(
    {
      purpose: "facebook_channel_connect",
      userId: userId.toString(),
      companyId: companyId.toString(),
      nonce,
    },
    requireEnvironmentVariable("META_OAUTH_STATE_SECRET"),
    {
      algorithm: "HS256",
      audience: STATE_AUDIENCE,
      expiresIn: "10m",
      issuer: STATE_ISSUER,
    }
  );

export const verifyFacebookOAuthState = (state) => {
  const payload = jwt.verify(
    state,
    requireEnvironmentVariable("META_OAUTH_STATE_SECRET"),
    {
      algorithms: ["HS256"],
      audience: STATE_AUDIENCE,
      issuer: STATE_ISSUER,
    }
  );

  if (payload.purpose !== "facebook_channel_connect") {
    throw new Error("Invalid Facebook OAuth state purpose.");
  }

  return payload;
};

export const buildFacebookAuthorizationUrl = (state) => {
  const config = getMetaConfig();
  const authorizationUrl = new URL(
    `https://www.facebook.com/${config.graphVersion}/dialog/oauth`
  );

  authorizationUrl.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(","),
    state,
  }).toString();

  return authorizationUrl.toString();
};

export const exchangeFacebookAuthorizationCode = async (code) => {
  const config = getMetaConfig();
  const response = await axios.get(
    `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
    {
      params: {
        client_id: config.appId,
        client_secret: config.appSecret,
        code,
        redirect_uri: config.redirectUri,
      },
      timeout: 15000,
    }
  );

  if (!response.data?.access_token) {
    throw new Error("Meta did not return a user access token.");
  }

  return response.data.access_token;
};

const getGraphUrl = (path) => {
  const { graphVersion } = getMetaConfig();
  return `https://graph.facebook.com/${graphVersion}/${path}`;
};

const fetchManagedPages = async (userAccessToken) => {
  const pages = [];
  let after;

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const response = await axios.get(getGraphUrl("me/accounts"), {
      params: {
        access_token: userAccessToken,
        fields: "id,name,access_token,tasks",
        limit: 100,
        ...(after ? { after } : {}),
      },
      timeout: 15000,
    });

    pages.push(...(response.data?.data || []));
    const nextCursor = response.data?.paging?.cursors?.after;

    if (!response.data?.paging?.next || !nextCursor || nextCursor === after) {
      break;
    }

    after = nextCursor;
  }

  return pages;
};

export const getFacebookOAuthAccountData = async (userAccessToken) => {
  const [userResponse, permissionsResponse, pages] = await Promise.all([
    axios.get(getGraphUrl("me"), {
      params: { access_token: userAccessToken, fields: "id" },
      timeout: 15000,
    }),
    axios.get(getGraphUrl("me/permissions"), {
      params: { access_token: userAccessToken },
      timeout: 15000,
    }),
    fetchManagedPages(userAccessToken),
  ]);

  const grantedPermissions = (permissionsResponse.data?.data || [])
    .filter((permission) => permission.status === "granted")
    .map((permission) => permission.permission);

  return {
    metaUserId: userResponse.data?.id,
    grantedPermissions,
    pages,
  };
};

export const buildFacebookFrontendReturnUrl = ({ status, message }) => {
  const frontendUrl = requireEnvironmentVariable("FRONTEND_URL").replace(
    /\/$/,
    ""
  );
  const returnUrl = new URL(`${frontendUrl}/dashboard/channels/facebook`);
  returnUrl.searchParams.set("facebookOAuth", status);

  if (message) {
    returnUrl.searchParams.set("message", message);
  }

  return returnUrl.toString();
};

export class FacebookConnectionVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FacebookConnectionVerificationError";
  }
}

export const verifyFacebookPageConnection = async ({
  pageId,
  pageAccessToken,
}) => {
  const config = getMetaConfig();

  let pageResponse;
  let tokenDebugResponse;

  try {
    [pageResponse, tokenDebugResponse] = await Promise.all([
      axios.get(getGraphUrl(pageId), {
        params: {
          access_token: pageAccessToken,
          fields: "id,name",
        },
        timeout: 15000,
      }),
      axios.get(getGraphUrl("debug_token"), {
        params: {
          input_token: pageAccessToken,
          access_token: `${config.appId}|${config.appSecret}`,
        },
        timeout: 15000,
      }),
    ]);
  } catch {
    throw new FacebookConnectionVerificationError(
      "Meta could not verify the selected Facebook Page or its access token."
    );
  }

  const page = pageResponse.data;
  const tokenData = tokenDebugResponse.data?.data;

  if (!page?.id || page.id !== pageId) {
    throw new FacebookConnectionVerificationError(
      "Meta returned a different Page than the selected Facebook Page."
    );
  }

  if (
    !tokenData?.is_valid ||
    String(tokenData.app_id) !== String(config.appId)
  ) {
    throw new FacebookConnectionVerificationError(
      "The selected Facebook Page access token is invalid for this Meta app."
    );
  }

  const hasGeneralMessagingScope = (tokenData.scopes || []).includes(
    "pages_messaging"
  );
  const granularMessagingScope = (tokenData.granular_scopes || []).find(
    (scope) => scope.scope === "pages_messaging"
  );
  const hasGranularMessagingScope = Boolean(
    granularMessagingScope &&
      (!granularMessagingScope.target_ids?.length ||
        granularMessagingScope.target_ids.includes(pageId))
  );

  if (!hasGeneralMessagingScope && !hasGranularMessagingScope) {
    throw new FacebookConnectionVerificationError(
      "The selected Facebook Page has not granted the pages_messaging permission."
    );
  }

  return {
    pageId: page.id,
    pageName: page.name,
    tokenValid: true,
    messagingPermissionGranted: true,
  };
};
