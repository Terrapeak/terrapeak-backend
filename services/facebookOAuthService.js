import axios from "axios";
import jwt from "jsonwebtoken";

const STATE_ISSUER = "terrapeak";
const STATE_AUDIENCE = "facebook-channel-oauth";
const DEFAULT_SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_messaging"];

const getQueryString = (value) => typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
const requireEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};
const getMetaConfig = () => {
  const graphVersion = requireEnvironmentVariable("META_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("META_GRAPH_API_VERSION must use a value such as v24.0.");
  return {
    appId: requireEnvironmentVariable("META_APP_ID"),
    appSecret: requireEnvironmentVariable("META_APP_SECRET"),
    graphVersion,
    redirectUri: requireEnvironmentVariable("META_OAUTH_REDIRECT_URI"),
    scopes: process.env.META_OAUTH_SCOPES ? process.env.META_OAUTH_SCOPES.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_SCOPES,
  };
};
const getGraphUrl = (path) => `https://graph.facebook.com/${getMetaConfig().graphVersion}/${path}`;

export const createFacebookOAuthState = ({ userId, companyId, nonce }) => jwt.sign(
  { purpose: "facebook_channel_connect", userId: userId.toString(), companyId: companyId.toString(), nonce },
  requireEnvironmentVariable("META_OAUTH_STATE_SECRET"),
  { algorithm: "HS256", audience: STATE_AUDIENCE, expiresIn: "10m", issuer: STATE_ISSUER }
);

export const verifyFacebookOAuthState = (state) => {
  const payload = jwt.verify(state, requireEnvironmentVariable("META_OAUTH_STATE_SECRET"), { algorithms: ["HS256"], audience: STATE_AUDIENCE, issuer: STATE_ISSUER });
  if (payload.purpose !== "facebook_channel_connect") throw new Error("Invalid Facebook OAuth state purpose.");
  return payload;
};

export const parseFacebookOAuthCallbackQuery = (query = {}) => {
  const error = getQueryString(query.error);
  return {
    state: getQueryString(query.state),
    code: getQueryString(query.code),
    metaError: error ? { error, reason: getQueryString(query.error_reason), description: getQueryString(query.error_description), code: getQueryString(query.error_code) } : null,
  };
};

export const buildFacebookAuthorizationUrl = (state) => {
  const config = getMetaConfig();
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: "code", scope: config.scopes.join(","), state }).toString();
  return url.toString();
};

export class FacebookOAuthApiError extends Error {
  constructor(message, { phase, status, statusText, metaError, requestContext, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "FacebookOAuthApiError";
    Object.assign(this, { phase, status, statusText, metaError, requestContext });
  }
}

const toFacebookOAuthApiError = (error, phase, requestContext) => {
  const meta = error.response?.data?.error;
  const status = error.response?.status;
  const message = typeof meta?.message === "string" && meta.message.trim() ? meta.message.trim() : error.message;
  return new FacebookOAuthApiError(`Meta ${phase} failed${status ? ` with HTTP ${status}` : ""}: ${message}`, {
    phase,
    status,
    statusText: error.response?.statusText,
    requestContext,
    metaError: meta ? { type: meta.type, code: meta.code, subcode: meta.error_subcode, message: meta.message, traceId: meta.fbtrace_id || error.response?.headers?.["x-fb-trace-id"] } : undefined,
    cause: error,
  });
};

const getFromMeta = async (url, options, phase, { retryServerErrors = true, requestContext } = {}) => {
  const max = retryServerErrors ? 2 : 1;
  for (let attempt = 0; attempt < max; attempt += 1) {
    try { return await axios.get(url, options); }
    catch (error) {
      const status = error.response?.status;
      if (!(retryServerErrors && attempt + 1 < max && status >= 500 && status < 600)) throw toFacebookOAuthApiError(error, phase, requestContext);
    }
  }
  throw new FacebookOAuthApiError(`Meta ${phase} failed.`, { phase });
};

export const exchangeFacebookAuthorizationCode = async (code) => {
  const config = getMetaConfig();
  const endpoint = `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`;
  const response = await getFromMeta(endpoint, {
    params: { client_id: config.appId, client_secret: config.appSecret, code, redirect_uri: config.redirectUri },
    headers: { Accept: "application/json" }, timeout: 15000,
  }, "authorization-code exchange", {
    retryServerErrors: false,
    requestContext: { method: "GET", endpoint, graphVersion: config.graphVersion, redirectUri: config.redirectUri, parameterNames: ["client_id", "client_secret", "code", "redirect_uri"] },
  });
  if (!response.data?.access_token) throw new Error("Meta did not return a user access token.");
  return response.data.access_token;
};

const fetchManagedPages = async (token) => {
  const pages = [];
  let after;
  for (let i = 0; i < 20; i += 1) {
    const response = await getFromMeta(getGraphUrl("me/accounts"), { params: { access_token: token, fields: "id,name,access_token,tasks", limit: 100, ...(after ? { after } : {}) }, timeout: 15000 }, "managed-Pages retrieval");
    pages.push(...(response.data?.data || []));
    const next = response.data?.paging?.cursors?.after;
    if (!response.data?.paging?.next || !next || next === after) break;
    after = next;
  }
  return pages;
};

const fetchTokenDebugData = async (token) => {
  const config = getMetaConfig();
  const response = await getFromMeta(getGraphUrl("debug_token"), {
    params: { input_token: token, access_token: `${config.appId}|${config.appSecret}` }, timeout: 15000,
  }, "token diagnostics retrieval");
  return response.data?.data || {};
};

const getGranularPageIds = (tokenData) => {
  const pageScopes = new Set(["pages_show_list", "pages_manage_metadata", "pages_messaging"]);
  return [...new Set((tokenData.granular_scopes || [])
    .filter((item) => pageScopes.has(item.scope))
    .flatMap((item) => item.target_ids || [])
    .map(String))];
};

const fetchGrantedPagesDirectly = async (token, pageIds) => {
  const results = await Promise.all(pageIds.map(async (pageId) => {
    try {
      const response = await getFromMeta(getGraphUrl(pageId), {
        params: { access_token: token, fields: "id,name,access_token,tasks" }, timeout: 15000,
      }, "granted-Page retrieval", { retryServerErrors: false });
      return response.data?.id && response.data?.name && response.data?.access_token ? response.data : null;
    } catch (error) {
      console.error("Granted Facebook Page retrieval failed", { pageId, message: error?.message || error });
      return null;
    }
  }));
  return results.filter(Boolean);
};

export const getFacebookOAuthAccountData = async (userAccessToken) => {
  const [userResponse, permissionsResponse, managedPages, tokenData] = await Promise.all([
    getFromMeta(getGraphUrl("me"), { params: { access_token: userAccessToken, fields: "id" }, timeout: 15000 }, "Meta-user retrieval"),
    getFromMeta(getGraphUrl("me/permissions"), { params: { access_token: userAccessToken }, timeout: 15000 }, "permission retrieval"),
    fetchManagedPages(userAccessToken),
    fetchTokenDebugData(userAccessToken),
  ]);
  const grantedPermissions = (permissionsResponse.data?.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
  const granularPageIds = getGranularPageIds(tokenData);
  const pages = managedPages.length ? managedPages : await fetchGrantedPagesDirectly(userAccessToken, granularPageIds);
  return { metaUserId: userResponse.data?.id, grantedPermissions, granularPageIds, pages, managedPageCount: managedPages.length };
};

export const buildFacebookFrontendReturnUrl = ({ status, message }) => {
  const frontend = requireEnvironmentVariable("FRONTEND_URL").replace(/\/$/, "");
  const url = new URL(`${frontend}/dashboard/channels/facebook`);
  url.searchParams.set("facebookOAuth", status);
  if (message) url.searchParams.set("message", message);
  return url.toString();
};

export class FacebookConnectionVerificationError extends Error {
  constructor(message) { super(message); this.name = "FacebookConnectionVerificationError"; }
}

export const verifyFacebookPageConnection = async ({ pageId, pageAccessToken }) => {
  const config = getMetaConfig();
  let pageResponse;
  let tokenDebugResponse;
  try {
    [pageResponse, tokenDebugResponse] = await Promise.all([
      axios.get(getGraphUrl(pageId), { params: { access_token: pageAccessToken, fields: "id,name" }, timeout: 15000 }),
      axios.get(getGraphUrl("debug_token"), { params: { input_token: pageAccessToken, access_token: `${config.appId}|${config.appSecret}` }, timeout: 15000 }),
    ]);
  } catch {
    throw new FacebookConnectionVerificationError("Meta could not verify the selected Facebook Page or its access token.");
  }
  const page = pageResponse.data;
  const tokenData = tokenDebugResponse.data?.data;
  if (!page?.id || page.id !== pageId) throw new FacebookConnectionVerificationError("Meta returned a different Page than the selected Facebook Page.");
  if (!tokenData?.is_valid || String(tokenData.app_id) !== String(config.appId)) throw new FacebookConnectionVerificationError("The selected Facebook Page access token is invalid for this Meta app.");
  const hasGeneral = (tokenData.scopes || []).includes("pages_messaging");
  const granular = (tokenData.granular_scopes || []).find((s) => s.scope === "pages_messaging");
  const hasGranular = Boolean(granular && (!granular.target_ids?.length || granular.target_ids.includes(pageId)));
  if (!hasGeneral && !hasGranular) throw new FacebookConnectionVerificationError("The selected Facebook Page has not granted the pages_messaging permission.");
  return { pageId: page.id, pageName: page.name, tokenValid: true, messagingPermissionGranted: true };
};
