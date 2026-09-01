import axios from "axios";
import BaseAvatarProvider from "./baseAvatarProvider.js";

const API_BASE_URL = "https://api.heygen.com";
const TIMEOUT_MS = 30_000;
const VOICE_DIAGNOSTIC_VERSION = "avatar-voice-live-contract-v1";
const VOICE_DIAGNOSTIC_KEYS = ["data", "items", "voices", "has_more", "next_token"];
const VOICE_DIAGNOSTIC_ITEM_FIELDS = ["voice_id", "name", "language", "gender", "type", "support_pause", "support_locale", "preview_audio_url"];
const VOICE_DIAGNOSTIC_STAGES = new Set(["BODY_SHAPE", "PAGINATION", "ITEM_NORMALIZATION", "DEDUPLICATION", "PERSISTENCE"]);
const CURSOR_PARAMETER_NAME = "token";
const PAGINATION_FAILURE_REASONS = new Set(["MISSING_NEXT_TOKEN", "EMPTY_NEXT_TOKEN", "INVALID_NEXT_TOKEN_TYPE", "REPEATED_NEXT_TOKEN", "PAGE_LIMIT_EXCEEDED", "NEXT_PAGE_HTTP_FAILURE", "NEXT_PAGE_BODY_INVALID", "OTHER_PAGINATION_FAILURE"]);
const avatarError = (code, statusCode = 502) => {
  const messages = {
    AVATAR_PROVIDER_NOT_CONFIGURED: "TerraPeak Avatar is not configured.", AVATAR_PROVIDER_AUTH_FAILED: "TerraPeak Avatar authentication failed.",
    AVATAR_PROVIDER_QUOTA_EXCEEDED: "TerraPeak Avatar usage capacity has been reached.", AVATAR_PROVIDER_RATE_LIMITED: "TerraPeak Avatar is receiving too many requests.",
    AVATAR_NOT_FOUND: "The TerraPeak Avatar could not be found.", AVATAR_NOT_READY: "The TerraPeak Avatar is not ready.",
    AVATAR_VIDEO_FAILED: "TerraPeak Avatar could not generate the video.", AVATAR_PROVIDER_TIMEOUT: "TerraPeak Avatar timed out.",
    AVATAR_PROVIDER_UNAVAILABLE: "TerraPeak Avatar is temporarily unavailable.", AVATAR_PROVIDER_INVALID_RESPONSE: "TerraPeak Avatar returned an invalid response.",
    AVATAR_PROVIDER_VOICE_NOT_FOUND: "The Avatar voice could not be found.", AVATAR_PROVIDER_VOICE_NOT_READY: "The Avatar voice is not ready.",
  };
  const error = new Error(messages[code] || messages.AVATAR_PROVIDER_UNAVAILABLE); error.code = code; error.statusCode = statusCode; return error;
};
const safeCode = (value) => { const code = String(value || "").trim().toLowerCase(); return /^[a-z0-9_.-]{1,100}$/.test(code) ? code : ""; };
const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
const valueType = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const responsePage = (response) => {
  const body = response?.data && typeof response.data === "object" && !Array.isArray(response.data) ? response.data : null;
  const nested = body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
  return { body, page: nested || body };
};
const voiceDiagnosticEvent = ({ response, ownershipType, failureStage, pageNumber, paginationFailureReason, requestParams }) => {
  const { body, page } = responsePage(response);
  const arrays = [body?.data, body?.items, body?.voices, page?.items, page?.data, page?.voices];
  const items = arrays.find(Array.isArray) || [];
  const first = items[0] && typeof items[0] === "object" && !Array.isArray(items[0]) ? items[0] : null;
  return {
    event: "digital_clone_avatar_voice_discovery_diagnostic",
    diagnosticVersion: VOICE_DIAGNOSTIC_VERSION,
    provider: "heygen",
    ownershipType,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    topLevelKeys: VOICE_DIAGNOSTIC_KEYS.filter((key) => hasOwn(body, key)),
    hasDataArray: hasOwn(body, "data") && Array.isArray(body.data),
    hasItemsArray: hasOwn(body, "items") && Array.isArray(body.items),
    hasVoicesArray: hasOwn(body, "voices") && Array.isArray(body.voices),
    dataIsArray: Array.isArray(body?.data),
    itemsIsArray: Array.isArray(body?.items),
    voicesIsArray: Array.isArray(body?.voices),
    itemCount: items.length,
    hasMorePresent: hasOwn(page, "has_more"),
    hasMoreType: valueType(page?.has_more),
    nextTokenPresent: hasOwn(page, "next_token"),
    nextTokenType: valueType(page?.next_token),
    firstItemFieldPresence: Object.fromEntries(VOICE_DIAGNOSTIC_ITEM_FIELDS.map((field) => [field, hasOwn(first, field)])),
    cursorParameterName: CURSOR_PARAMETER_NAME,
    cursorIncluded: hasOwn(requestParams, CURSOR_PARAMETER_NAME),
    ownershipParameterIncluded: hasOwn(requestParams, "type") || hasOwn(requestParams, "ownership"),
    failureStage: VOICE_DIAGNOSTIC_STAGES.has(failureStage) ? failureStage : "BODY_SHAPE",
    paginationFailureReason: PAGINATION_FAILURE_REASONS.has(paginationFailureReason) ? paginationFailureReason : "OTHER_PAGINATION_FAILURE",
  };
};
const extractPage = (response) => {
  const body = response?.data;
  const page = body && typeof body === "object" && (Array.isArray(body.items) || Array.isArray(body.data))
    ? body
    : body?.data && typeof body.data === "object" ? body.data : null;
  const items = Array.isArray(page?.items) ? page.items : Array.isArray(page?.data) ? page.data : null;
  if (!items || typeof page.has_more !== "boolean") throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
  return { items, hasMore: page.has_more, nextToken: page.next_token };
};
export const mapHeyGenError = (error, operation = "request") => {
  if (error?.code?.startsWith?.("AVATAR_")) return error;
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) return avatarError("AVATAR_PROVIDER_TIMEOUT", 504);
  const status = Number(error?.response?.status); const data = error?.response?.data;
  const code = safeCode(data?.error?.code || data?.code || data?.error);
  if (status === 401 || status === 403) return avatarError("AVATAR_PROVIDER_AUTH_FAILED");
  if (status === 402 || ["insufficient_credits", "quota_exceeded"].includes(code)) return avatarError("AVATAR_PROVIDER_QUOTA_EXCEEDED");
  if (status === 429) return avatarError("AVATAR_PROVIDER_RATE_LIMITED", 429);
  if (status === 404) return avatarError(operation === "video" ? "AVATAR_VIDEO_FAILED" : "AVATAR_NOT_FOUND", 404);
  if ([400, 409, 422].includes(status)) {
    if (["avatar_not_ready", "avatar_training", "avatar_not_found"].includes(code)) return avatarError("AVATAR_NOT_READY", 409);
    return avatarError(operation === "video" ? "AVATAR_VIDEO_FAILED" : "AVATAR_PROVIDER_INVALID_RESPONSE", 400);
  }
  return avatarError("AVATAR_PROVIDER_UNAVAILABLE", 503);
};
const normalizeType = (value) => ({ photo_avatar: "photo-avatar", digital_twin: "digital-twin", studio_avatar: "studio-avatar" }[String(value || "").toLowerCase()] || "unknown");
const normalizeOrientation = (look) => { const preferred = safeCode(look.preferred_orientation); if (["portrait", "landscape"].includes(preferred)) return preferred; const width = Number(look.image_width); const height = Number(look.image_height); if (!width || !height) return "unknown"; return width === height ? "square" : height > width ? "portrait" : "landscape"; };
const normalizeLook = (group, look) => {
  const engines = Array.isArray(look.supported_api_engines) ? look.supported_api_engines.map(safeCode).filter(Boolean) : [];
  const groupStatus = group?.status == null ? null : safeCode(group.status);
  const consentStatus = group?.consent_status == null ? null : safeCode(group.consent_status);
  let primaryReason = "";
  if (!group) primaryReason = "GROUP_NOT_FOUND";
  else if (groupStatus !== null && groupStatus !== "completed") primaryReason = "GROUP_STATUS_INVALID";
  else if (consentStatus !== null && !["approved", "completed"].includes(consentStatus)) primaryReason = "CONSENT_INVALID";
  else if (look?.status == null) primaryReason = "LOOK_STATUS_MISSING";
  else if (look.status !== "completed") primaryReason = "LOOK_STATUS_INVALID";
  else if (!Array.isArray(look.supported_api_engines) || engines.length === 0) primaryReason = "SUPPORTED_ENGINES_MISSING";
  else if (!engines.some((engine) => ["avatar_v", "avatar_iv"].includes(engine))) primaryReason = "UNSUPPORTED_ENGINE";
  return {
    groupRef: String(group?.id || look?.group_id || ""), lookRef: String(look?.id || ""),
    defaultVoiceRef: String(look?.default_voice_id || group?.default_voice_id || ""),
    displayName: String(look?.name || group?.name || "TerraPeak Avatar").slice(0, 200),
    avatarType: normalizeType(look?.avatar_type || look?.type), orientation: normalizeOrientation(look),
    supportedCapabilities: engines, previewImageUrl: String(look?.preview_image_url || group?.preview_image_url || "").slice(0, 2000),
    readinessReasons: primaryReason ? [primaryReason] : [], ready: !primaryReason,
  };
};
const normalizeVoice = (voice) => {
  const voiceRef = String(voice?.voice_id || ""); const displayName = String(voice?.name || "").trim().slice(0, 200);
  const voiceType = ["public", "private"].includes(voice?.type) ? voice.type : "unknown";
  return { voiceRef, displayName, language: String(voice?.language || "Unknown").slice(0, 100), gender: safeCode(voice?.gender) || "unknown", voiceType, ready: Boolean(voiceRef && displayName && voiceType !== "unknown") };
};

export default class HeyGenAvatarProvider extends BaseAvatarProvider {
  constructor({ apiKey = process.env.HEYGEN_API_KEY, client = axios, timeoutMs = TIMEOUT_MS, baseUrl = API_BASE_URL, logger = console } = {}) {
    super({ name: "heygen" }); this.apiKey = String(apiKey || "").trim(); this.client = client; this.timeoutMs = timeoutMs; this.baseUrl = String(baseUrl || "").replace(/\/$/, ""); this.logger = logger;
  }
  assertConfigured() { if (!this.apiKey || this.baseUrl !== API_BASE_URL) throw avatarError("AVATAR_PROVIDER_NOT_CONFIGURED", 503); }
  options(extra = {}) { return { ...extra, headers: { "x-api-key": this.apiKey, ...(extra.headers || {}) }, timeout: this.timeoutMs }; }
  voiceDiagnostic({ response, ownershipType, failureStage, pageNumber, paginationFailureReason, requestParams }) {
    if (!["public", "private"].includes(ownershipType)) return;
    try { this.logger.info?.(voiceDiagnosticEvent({ response, ownershipType, failureStage, pageNumber, paginationFailureReason, requestParams })); } catch { /* diagnostics must never alter provider behavior */ }
  }
  async paged(path, params = {}, { voiceOwnershipType = null } = {}) {
    const values = []; const seenTokens = new Set(); let token; let lastResponse; let lastRequestParams;
    for (let page = 0; page < 10; page += 1) {
      const pageNumber = page + 1; const requestParams = { ...params, limit: 50, ...(token ? { [CURSOR_PARAMETER_NAME]: token } : {}) }; lastRequestParams = requestParams;
      let response;
      try { response = await this.client.get(`${this.baseUrl}${path}`, this.options({ params: requestParams })); }
      catch (error) {
        const mapped = mapHeyGenError(error, "voice-discovery");
        if (voiceOwnershipType && (pageNumber > 1 || mapped.code === "AVATAR_PROVIDER_INVALID_RESPONSE")) this.voiceDiagnostic({ response: error?.response, ownershipType: voiceOwnershipType, failureStage: pageNumber > 1 ? "PAGINATION" : "BODY_SHAPE", pageNumber, paginationFailureReason: pageNumber > 1 ? "NEXT_PAGE_HTTP_FAILURE" : "OTHER_PAGINATION_FAILURE", requestParams });
        throw error;
      }
      lastResponse = response; let result;
      try { result = extractPage(response); }
      catch (error) {
        if (voiceOwnershipType && error?.code === "AVATAR_PROVIDER_INVALID_RESPONSE") this.voiceDiagnostic({ response, ownershipType: voiceOwnershipType, failureStage: pageNumber > 1 ? "PAGINATION" : "BODY_SHAPE", pageNumber, paginationFailureReason: pageNumber > 1 ? "NEXT_PAGE_BODY_INVALID" : "OTHER_PAGINATION_FAILURE", requestParams });
        throw error;
      }
      values.push(...result.items); if (!result.hasMore) return values;
      const nextToken = String(result.nextToken || "").trim();
      if (!nextToken) {
        const { page: responsePageValue } = responsePage(response);
        const paginationFailureReason = !hasOwn(responsePageValue, "next_token") ? "MISSING_NEXT_TOKEN" : typeof result.nextToken !== "string" ? "INVALID_NEXT_TOKEN_TYPE" : "EMPTY_NEXT_TOKEN";
        this.voiceDiagnostic({ response, ownershipType: voiceOwnershipType, failureStage: "PAGINATION", pageNumber, paginationFailureReason, requestParams }); throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
      }
      if (seenTokens.has(nextToken)) { this.voiceDiagnostic({ response, ownershipType: voiceOwnershipType, failureStage: "PAGINATION", pageNumber, paginationFailureReason: "REPEATED_NEXT_TOKEN", requestParams }); throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE"); }
      token = nextToken; seenTokens.add(token);
    }
    this.voiceDiagnostic({ response: lastResponse, ownershipType: voiceOwnershipType, failureStage: "PAGINATION", pageNumber: 10, paginationFailureReason: "PAGE_LIMIT_EXCEEDED", requestParams: lastRequestParams });
    throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
  }
  async listAvatars() {
    this.assertConfigured();
    try {
      const [groups, looks] = await Promise.all([this.paged("/v3/avatars", { ownership: "private" }), this.paged("/v3/avatars/looks", { ownership: "private" })]);
      const byId = new Map(groups.map((group) => [String(group.id), group]));
      const normalized = looks.map((look) => normalizeLook(byId.get(String(look.group_id)), look)).filter((item) => item.groupRef && item.lookRef);
      return normalized;
    } catch (error) { throw mapHeyGenError(error, "discovery"); }
  }
  async getAvatar({ groupRef, lookRef }) { const avatar = (await this.listAvatars()).find((item) => item.groupRef === groupRef && item.lookRef === lookRef); if (!avatar) throw avatarError("AVATAR_NOT_FOUND", 404); return avatar; }
  async listVoices() {
    this.assertConfigured();
    try {
      const [publicVoices, privateVoices] = await Promise.all([this.paged("/v3/voices", { type: "public" }, { voiceOwnershipType: "public" }), this.paged("/v3/voices", { type: "private" }, { voiceOwnershipType: "private" })]);
      const normalized = new Map();
      for (const value of [...publicVoices, ...privateVoices]) { const voice = normalizeVoice(value); if (voice.voiceRef) normalized.set(voice.voiceRef, voice); }
      return [...normalized.values()];
    } catch (error) { throw mapHeyGenError(error, "voice-discovery"); }
  }
  async getVoice({ voiceRef }) { const voice = (await this.listVoices()).find((item) => item.voiceRef === voiceRef); if (!voice) throw avatarError("AVATAR_PROVIDER_VOICE_NOT_FOUND", 404); return voice; }
  async createVideo({ avatar, voice, script, aspectRatio, resolution, captions, background, idempotencyKey }) {
    this.assertConfigured(); const engine = avatar.supportedCapabilities.includes("avatar_v") ? "avatar_v" : "avatar_iv"; const colors = { light: "#F7F8FA", dark: "#172033" };
    if (!voice?.voiceRef) throw avatarError("AVATAR_PROVIDER_VOICE_NOT_READY", 409);
    const body = { type: "avatar", avatar_id: avatar.lookRef, voice_id: voice.voiceRef, title: "TerraPeak Avatar Test", script, aspect_ratio: aspectRatio, resolution, output_format: "mp4", engine: { type: engine }, ...(captions ? { caption: { file_format: "srt", style: "default" } } : {}), ...(colors[background] ? { background: { value: colors[background] } } : {}) };
    try {
      const response = await this.client.post(`${this.baseUrl}/v3/videos`, body, this.options({ headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey } }));
      const jobRef = String(response?.data?.data?.video_id || ""); if (!jobRef) throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
      return { jobRef, status: safeCode(response?.data?.data?.status) === "completed" ? "completed" : "processing" };
    } catch (error) { throw mapHeyGenError(error, "video"); }
  }
  async getVideoStatus({ jobRef }) {
    this.assertConfigured();
    try {
      const response = await this.client.get(`${this.baseUrl}/v3/videos/${encodeURIComponent(jobRef)}`, this.options()); const data = response?.data?.data;
      if (!data || typeof data !== "object") throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE"); const status = safeCode(data.status);
      if (["pending", "queued", "processing", "waiting"].includes(status)) return { status: "processing" };
      if (status === "failed") return { status: "failed", failureCode: safeCode(data.failure_code) || "generation_failed" };
      if (status !== "completed" || !data.video_url) throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
      return { status: "completed", resultUrl: String(data.video_url), durationSeconds: Number(data.duration) || null };
    } catch (error) { throw mapHeyGenError(error, "video"); }
  }
}
export { avatarError };
