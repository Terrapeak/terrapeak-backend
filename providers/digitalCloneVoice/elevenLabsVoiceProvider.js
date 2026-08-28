import axios from "axios";
import BaseVoiceProvider from "./baseVoiceProvider.js";

export const ELEVENLABS_MAX_SAMPLE_BYTES = 75 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const API_BASE_URL = "https://api.elevenlabs.io";
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const VALID_OUTPUT_FORMATS = new Set([
  "mp3_22050_32",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
]);

const providerError = (code, statusCode = 502) => {
  const messages = {
    VOICE_PROVIDER_AUTH_FAILED: "TerraPeak Voice authentication failed.",
    VOICE_PROVIDER_QUOTA_EXCEEDED: "TerraPeak Voice usage capacity has been reached.",
    VOICE_PROVIDER_RATE_LIMITED: "TerraPeak Voice is receiving too many requests.",
    VOICE_PROVIDER_PLAN_REQUIRED: "TerraPeak Voice is not enabled for this account.",
    VOICE_SAMPLE_REJECTED: "One or more voice recordings could not be accepted.",
    VOICE_PROVIDER_INVALID_REQUEST: "TerraPeak Voice could not accept the request.",
    VOICE_VERIFICATION_REQUIRED: "Additional voice verification is required before this voice can be used.",
    VOICE_NOT_FOUND: "The TerraPeak Voice resource could not be found.",
    VOICE_PROVIDER_TIMEOUT: "TerraPeak Voice timed out.",
    VOICE_PROVIDER_INVALID_RESPONSE: "TerraPeak Voice returned an invalid response.",
    VOICE_PROVIDER_UNAVAILABLE: "TerraPeak Voice is temporarily unavailable.",
  };
  const error = new Error(messages[code] || messages.VOICE_PROVIDER_UNAVAILABLE);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const safeToken = (value, fallback = "unknown") => {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/.test(token) ? token : fallback;
};

const safeRequestId = (value) => {
  const requestId = String(value || "").trim();
  return /^[a-zA-Z0-9_.:-]{1,120}$/.test(requestId) ? requestId : undefined;
};

const detailObject = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data.detail && typeof data.detail === "object" && !Array.isArray(data.detail) ? data.detail : data;
};

export const safeProviderDiagnostic = (error) => {
  const detail = detailObject(error?.response?.data);
  const headers = error?.response?.headers || {};
  const httpStatus = Number(error?.response?.status);
  return {
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : undefined,
    providerErrorType: safeToken(detail.type),
    providerErrorCode: safeToken(detail.code || detail.status),
    requestId: safeRequestId(detail.request_id) || safeRequestId(headers["request-id"] || headers["x-request-id"]),
  };
};

const SAMPLE_ERROR_CODES = new Set([
  "invalid_audio",
  "invalid_audio_format",
  "audio_too_long",
  "audio_too_short",
  "invalid_file_type",
]);
const PLAN_ERROR_CODES = new Set(["feature_not_available", "subscription_required"]);
const AUTH_ERROR_CODES = new Set([
  "invalid_api_key",
  "missing_api_key",
  "invalid_authorization_header",
  "unauthorized",
  "sign_in_required",
]);
const RATE_ERROR_CODES = new Set(["rate_limit_exceeded", "concurrent_limit_exceeded", "system_busy"]);

export const mapElevenLabsProviderError = (error, operation) => {
  if (error?.code?.startsWith?.("VOICE_")) return error;
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) {
    return providerError("VOICE_PROVIDER_TIMEOUT", 504);
  }
  const diagnostic = safeProviderDiagnostic(error);
  const status = diagnostic.httpStatus;
  const type = diagnostic.providerErrorType;
  const code = diagnostic.providerErrorCode;
  if (status === 402 || type === "payment_required" || code === "insufficient_credits" || code === "quota_exceeded") {
    return providerError("VOICE_PROVIDER_QUOTA_EXCEEDED");
  }
  if (PLAN_ERROR_CODES.has(code)) return providerError("VOICE_PROVIDER_PLAN_REQUIRED", 403);
  if (code === "verification_required") return providerError("VOICE_VERIFICATION_REQUIRED", 409);
  if (status === 401 || type === "authentication_error" || AUTH_ERROR_CODES.has(code)) {
    return providerError("VOICE_PROVIDER_AUTH_FAILED");
  }
  if (status === 429 || type === "rate_limit_error" || RATE_ERROR_CODES.has(code)) {
    return providerError("VOICE_PROVIDER_RATE_LIMITED", 429);
  }
  if (operation !== "create" && (status === 404 || type === "not_found" || code === "voice_not_found")) {
    return providerError("VOICE_NOT_FOUND", 404);
  }
  if (operation === "create" && SAMPLE_ERROR_CODES.has(code)) {
    return providerError("VOICE_SAMPLE_REJECTED", 400);
  }
  if (
    [400, 409, 422].includes(status) ||
    ["validation_error", "invalid_request", "conflict"].includes(type)
  ) {
    return providerError("VOICE_PROVIDER_INVALID_REQUEST", 400);
  }
  if (status === 403 || type === "authorization_error") return providerError("VOICE_PROVIDER_AUTH_FAILED", 403);
  if (status === 404) return providerError("VOICE_NOT_FOUND", 404);
  if (status >= 500 || !status) return providerError("VOICE_PROVIDER_UNAVAILABLE");
  return providerError("VOICE_PROVIDER_UNAVAILABLE");
};

const sampleDiagnostics = (samples = []) => ({
  sampleCount: samples.length,
  sampleMimeTypes: [...new Set(samples.map((sample) => {
    const mimeType = String(sample?.mimeType || "").trim().toLowerCase();
    return /^audio\/[a-z0-9.+-]{1,60}$/.test(mimeType) ? mimeType : "unknown";
  }))],
  sampleExtensions: [...new Set(samples.map((sample) => {
    const match = String(sample?.filename || "").toLowerCase().match(/\.[a-z0-9]{1,10}$/);
    return match ? match[0] : "unknown";
  }))],
  totalBytes: samples.reduce((total, sample) => total + (Buffer.isBuffer(sample?.buffer) ? sample.buffer.length : 0), 0),
});

const SAFE_PROVIDER_MESSAGES = Object.freeze({
  VOICE_PROVIDER_AUTH_FAILED: "provider authentication or authorization failed",
  VOICE_PROVIDER_QUOTA_EXCEEDED: "provider credits or quota unavailable",
  VOICE_PROVIDER_RATE_LIMITED: "provider rate or concurrency limit reached",
  VOICE_PROVIDER_PLAN_REQUIRED: "provider plan does not enable this capability",
  VOICE_SAMPLE_REJECTED: "provider rejected an audio sample",
  VOICE_PROVIDER_INVALID_REQUEST: "provider rejected the request structure or parameters",
  VOICE_VERIFICATION_REQUIRED: "provider requires additional voice verification",
  VOICE_PROVIDER_TIMEOUT: "provider request timed out",
  VOICE_PROVIDER_UNAVAILABLE: "provider unavailable",
  VOICE_PROVIDER_INVALID_RESPONSE: "provider returned an invalid response",
  VOICE_NOT_FOUND: "provider voice not found",
});

const voiceSettings = ({ speakingPace = "moderate", expressiveness = 3 } = {}) => {
  const pace = { slow: 0.85, moderate: 1, fast: 1.15 }[speakingPace] || 1;
  const expression = Math.min(5, Math.max(1, Number(expressiveness) || 3));
  return {
    stability: Number((0.85 - expression * 0.1).toFixed(2)),
    similarity_boost: 0.75,
    style: Number(((expression - 1) * 0.1).toFixed(2)),
    use_speaker_boost: true,
    speed: pace,
  };
};

export default class ElevenLabsVoiceProvider extends BaseVoiceProvider {
  constructor({
    apiKey = process.env.ELEVENLABS_API_KEY,
    modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID,
    outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT,
    timeoutMs = 120_000,
    client = axios,
    baseUrl = API_BASE_URL,
    logger = console,
  } = {}) {
    super({ name: "elevenlabs" });
    this.apiKey = String(apiKey || "").trim();
    this.modelId = String(modelId || "").trim();
    this.outputFormat = String(outputFormat || "").trim();
    this.timeoutMs = timeoutMs;
    this.client = client;
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.logger = logger;
  }

  logProviderError({ error, mappedError, operation, samples = [] }) {
    const diagnostic = safeProviderDiagnostic(error);
    const entry = {
      event: "digital_clone_voice_provider_error",
      provider: "elevenlabs",
      operation,
      httpStatus: diagnostic.httpStatus,
      terrapeakCode: mappedError.code,
      providerErrorType: diagnostic.providerErrorType,
      providerErrorCode: diagnostic.providerErrorCode,
      sanitizedProviderMessage: SAFE_PROVIDER_MESSAGES[mappedError.code] || "provider request failed",
      requestId: diagnostic.requestId,
      ...(operation === "create_voice" ? sampleDiagnostics(samples) : {}),
    };
    try {
      this.logger?.error?.(entry);
    } catch {
      // Diagnostics must never alter provider error handling.
    }
  }

  assertConfigured() {
    if (
      !this.apiKey ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(this.modelId) ||
      !VALID_OUTPUT_FORMATS.has(this.outputFormat) ||
      this.baseUrl !== API_BASE_URL
    ) {
      const error = new Error("TerraPeak Voice is not configured.");
      error.statusCode = 503;
      error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
      throw error;
    }
  }

  async createVoice({ samples, name = "TerraPeak Voice" }) {
    this.assertConfigured();
    const totalBytes = (samples || []).reduce((total, sample) => total + (sample?.buffer?.length || 0), 0);
    if (!samples?.length || totalBytes <= 0 || totalBytes > ELEVENLABS_MAX_SAMPLE_BYTES) {
      throw providerError("VOICE_SAMPLE_REJECTED", 400);
    }
    const body = new FormData();
    body.append("name", String(name).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "TerraPeak Voice");
    body.append("remove_background_noise", "false");
    for (const sample of samples) {
      if (!Buffer.isBuffer(sample.buffer) || !sample.buffer.length) throw providerError("VOICE_SAMPLE_REJECTED", 400);
      body.append("files", new Blob([sample.buffer], { type: sample.mimeType }), sample.filename);
    }
    try {
      const response = await this.client.post(`${this.baseUrl}/v1/voices/add`, body, {
        headers: { "xi-api-key": this.apiKey },
        timeout: this.timeoutMs,
        maxBodyLength: ELEVENLABS_MAX_SAMPLE_BYTES + MULTIPART_OVERHEAD_BYTES,
      });
      const voiceId = String(response?.data?.voice_id || "").trim();
      if (!voiceId || typeof response?.data?.requires_verification !== "boolean") {
        throw providerError("VOICE_PROVIDER_INVALID_RESPONSE");
      }
      return {
        voiceId,
        status: response.data.requires_verification ? "verification_required" : "ready",
      };
    } catch (error) {
      const mappedError = mapElevenLabsProviderError(error, "create");
      this.logProviderError({ error, mappedError, operation: "create_voice", samples });
      throw mappedError;
    }
  }

  async generateSpeech({ voiceId, text, settings }) {
    this.assertConfigured();
    try {
      const response = await this.client.post(
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(this.outputFormat)}`,
        { text, model_id: this.modelId, voice_settings: voiceSettings(settings) },
        {
          headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
          responseType: "arraybuffer",
          timeout: this.timeoutMs,
          maxContentLength: MAX_RESPONSE_BYTES,
        },
      );
      const buffer = Buffer.from(response?.data || []);
      if (!buffer.length || buffer.length > MAX_RESPONSE_BYTES) throw providerError("VOICE_PROVIDER_INVALID_RESPONSE");
      return {
        buffer,
        mimeType: String(response.headers?.["content-type"] || "audio/mpeg").split(";")[0],
        usage: response.headers?.["character-cost"] ? { characterCost: String(response.headers["character-cost"]).slice(0, 30) } : undefined,
      };
    } catch (error) {
      if (error?.code === "ERR_BAD_RESPONSE" && /maxContentLength/.test(error?.message || "")) {
        throw providerError("VOICE_PROVIDER_INVALID_RESPONSE");
      }
      const mappedError = mapElevenLabsProviderError(error, "generate");
      this.logProviderError({ error, mappedError, operation: "generate_speech" });
      throw mappedError;
    }
  }

  async getStatus() {
    this.assertConfigured();
    return { status: "ready" };
  }

  async deleteVoice({ voiceId }) {
    this.assertConfigured();
    try {
      await this.client.delete(`${this.baseUrl}/v1/voices/${encodeURIComponent(voiceId)}`, {
        headers: { "xi-api-key": this.apiKey },
        timeout: 30_000,
      });
      return { deleted: true };
    } catch (error) {
      const mappedError = mapElevenLabsProviderError(error, "delete");
      this.logProviderError({ error, mappedError, operation: "delete_voice" });
      throw mappedError;
    }
  }
}
