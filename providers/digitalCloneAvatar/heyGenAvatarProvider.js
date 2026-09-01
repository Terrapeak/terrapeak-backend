import axios from "axios";
import BaseAvatarProvider from "./baseAvatarProvider.js";

const API_BASE_URL = "https://api.heygen.com";
const TIMEOUT_MS = 30_000;
const avatarError = (code, statusCode = 502) => {
  const messages = {
    AVATAR_PROVIDER_NOT_CONFIGURED: "TerraPeak Avatar is not configured.", AVATAR_PROVIDER_AUTH_FAILED: "TerraPeak Avatar authentication failed.",
    AVATAR_PROVIDER_QUOTA_EXCEEDED: "TerraPeak Avatar usage capacity has been reached.", AVATAR_PROVIDER_RATE_LIMITED: "TerraPeak Avatar is receiving too many requests.",
    AVATAR_NOT_FOUND: "The TerraPeak Avatar could not be found.", AVATAR_NOT_READY: "The TerraPeak Avatar is not ready.",
    AVATAR_VIDEO_FAILED: "TerraPeak Avatar could not generate the video.", AVATAR_PROVIDER_TIMEOUT: "TerraPeak Avatar timed out.",
    AVATAR_PROVIDER_UNAVAILABLE: "TerraPeak Avatar is temporarily unavailable.", AVATAR_PROVIDER_INVALID_RESPONSE: "TerraPeak Avatar returned an invalid response.",
  };
  const error = new Error(messages[code] || messages.AVATAR_PROVIDER_UNAVAILABLE); error.code = code; error.statusCode = statusCode; return error;
};
const safeCode = (value) => { const code = String(value || "").trim().toLowerCase(); return /^[a-z0-9_.-]{1,100}$/.test(code) ? code : ""; };
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
  return {
    groupRef: String(group?.id || look?.group_id || ""), lookRef: String(look?.id || ""),
    defaultVoiceRef: String(look?.default_voice_id || group?.default_voice_id || ""),
    displayName: String(look?.name || group?.name || "TerraPeak Avatar").slice(0, 200),
    avatarType: normalizeType(look?.avatar_type || look?.type), orientation: normalizeOrientation(look),
    supportedCapabilities: engines, previewImageUrl: String(look?.preview_image_url || group?.preview_image_url || "").slice(0, 2000),
    ready: group?.status === "completed" && group?.consent_status === "approved" && look?.status === "completed" && Boolean(look?.default_voice_id || group?.default_voice_id) && engines.some((engine) => ["avatar_v", "avatar_iv"].includes(engine)),
  };
};

export default class HeyGenAvatarProvider extends BaseAvatarProvider {
  constructor({ apiKey = process.env.HEYGEN_API_KEY, client = axios, timeoutMs = TIMEOUT_MS, baseUrl = API_BASE_URL } = {}) {
    super({ name: "heygen" }); this.apiKey = String(apiKey || "").trim(); this.client = client; this.timeoutMs = timeoutMs; this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
  }
  assertConfigured() { if (!this.apiKey || this.baseUrl !== API_BASE_URL) throw avatarError("AVATAR_PROVIDER_NOT_CONFIGURED", 503); }
  options(extra = {}) { return { ...extra, headers: { "x-api-key": this.apiKey, ...(extra.headers || {}) }, timeout: this.timeoutMs }; }
  async paged(path, params = {}) {
    const values = []; let token;
    for (let page = 0; page < 10; page += 1) {
      const response = await this.client.get(`${this.baseUrl}${path}`, this.options({ params: { ...params, limit: 50, ...(token ? { token } : {}) } }));
      if (!Array.isArray(response?.data?.data)) throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
      values.push(...response.data.data); if (!response.data.has_more) return values;
      token = String(response.data.next_token || ""); if (!token) throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
    }
    throw avatarError("AVATAR_PROVIDER_INVALID_RESPONSE");
  }
  async listAvatars() {
    this.assertConfigured();
    try {
      const [groups, looks] = await Promise.all([this.paged("/v3/avatars", { ownership: "private" }), this.paged("/v3/avatars/looks", { ownership: "private" })]);
      const byId = new Map(groups.map((group) => [String(group.id), group]));
      return looks.map((look) => normalizeLook(byId.get(String(look.group_id)), look)).filter((item) => item.groupRef && item.lookRef);
    } catch (error) { throw mapHeyGenError(error, "discovery"); }
  }
  async getAvatar({ groupRef, lookRef }) { const avatar = (await this.listAvatars()).find((item) => item.groupRef === groupRef && item.lookRef === lookRef); if (!avatar) throw avatarError("AVATAR_NOT_FOUND", 404); return avatar; }
  async createVideo({ avatar, script, aspectRatio, resolution, captions, background, idempotencyKey }) {
    this.assertConfigured(); const engine = avatar.supportedCapabilities.includes("avatar_v") ? "avatar_v" : "avatar_iv"; const colors = { light: "#F7F8FA", dark: "#172033" };
    const body = { type: "avatar", avatar_id: avatar.lookRef, title: "TerraPeak Avatar Test", script, aspect_ratio: aspectRatio, resolution, output_format: "mp4", engine: { type: engine }, ...(captions ? { caption: { file_format: "srt", style: "default" } } : {}), ...(colors[background] ? { background: { value: colors[background] } } : {}) };
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
