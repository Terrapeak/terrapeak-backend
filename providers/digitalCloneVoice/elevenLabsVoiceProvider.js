import axios from "axios";
import BaseVoiceProvider from "./baseVoiceProvider.js";

export const ELEVENLABS_MAX_SAMPLE_BYTES = 75 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const API_BASE_URL = "https://api.elevenlabs.io";
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
    VOICE_SAMPLE_REJECTED: "One or more voice recordings could not be accepted.",
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

const responseText = (error) => {
  try {
    return JSON.stringify(error?.response?.data || "").toLowerCase().slice(0, 2_000);
  } catch {
    return "";
  }
};

const mapProviderError = (error, operation) => {
  if (error?.code?.startsWith?.("VOICE_")) return error;
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) {
    return providerError("VOICE_PROVIDER_TIMEOUT", 504);
  }
  const status = Number(error?.response?.status);
  const detail = responseText(error);
  if (/(quota|credit|character.*limit|insufficient)/.test(detail)) {
    return providerError("VOICE_PROVIDER_QUOTA_EXCEEDED");
  }
  if (/verif/.test(detail)) return providerError("VOICE_VERIFICATION_REQUIRED", 409);
  if (operation !== "create" && /voice.{0,30}not found|not found.{0,30}voice/.test(detail)) {
    return providerError("VOICE_NOT_FOUND", 404);
  }
  if ([401, 403].includes(status)) {
    return providerError("VOICE_PROVIDER_AUTH_FAILED");
  }
  if (status === 429) {
    return providerError("VOICE_PROVIDER_RATE_LIMITED", 429);
  }
  if (status === 404) return providerError("VOICE_NOT_FOUND", 404);
  if (operation === "create" && [400, 422].includes(status)) {
    return providerError("VOICE_SAMPLE_REJECTED", 400);
  }
  if (status >= 500 || !status) return providerError("VOICE_PROVIDER_UNAVAILABLE");
  return providerError("VOICE_PROVIDER_UNAVAILABLE");
};

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
  } = {}) {
    super({ name: "elevenlabs" });
    this.apiKey = String(apiKey || "").trim();
    this.modelId = String(modelId || "").trim();
    this.outputFormat = String(outputFormat || "").trim();
    this.timeoutMs = timeoutMs;
    this.client = client;
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
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
        maxBodyLength: ELEVENLABS_MAX_SAMPLE_BYTES,
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
      throw mapProviderError(error, "create");
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
      throw mapProviderError(error, "generate");
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
      throw mapProviderError(error, "delete");
    }
  }
}
