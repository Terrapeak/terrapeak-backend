import axios from "axios";
import BaseVoiceProvider from "./baseVoiceProvider.js";

const providerError = (code = "VOICE_PROVIDER_UNAVAILABLE") => {
  const error = new Error("TerraPeak Voice is temporarily unavailable.");
  error.statusCode = 502;
  error.code = code;
  return error;
};

export default class ChatterboxVoiceProvider extends BaseVoiceProvider {
  constructor({ serviceUrl = process.env.CHATTERBOX_SERVICE_URL, timeoutMs = 120_000, client = axios } = {}) {
    super({ name: "chatterbox" });
    this.serviceUrl = String(serviceUrl || "").replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.client = client;
  }

  assertConfigured() {
    if (!this.serviceUrl) {
      const error = new Error("TerraPeak Voice is not configured.");
      error.statusCode = 503;
      error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
      throw error;
    }
    try {
      const endpoint = new URL(this.serviceUrl);
      if (!new Set(["http:", "https:"]).has(endpoint.protocol)) throw new Error("invalid protocol");
    } catch {
      const error = new Error("TerraPeak Voice is not configured.");
      error.statusCode = 503;
      error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
      throw error;
    }
  }

  async createVoice({ samples, language, settings }) {
    this.assertConfigured();
    const body = new FormData();
    body.append("language", language);
    body.append("settings", JSON.stringify(settings));
    samples.forEach((sample) => {
      body.append("samples", new Blob([sample.buffer], { type: sample.mimeType }), sample.filename);
    });
    try {
      const response = await this.client.post(`${this.serviceUrl}/v1/voices`, body, {
        timeout: this.timeoutMs,
        maxBodyLength: 250 * 1024 * 1024,
      });
      const voiceId = String(response?.data?.voiceId || "").trim();
      if (!voiceId) throw providerError("VOICE_PROVIDER_INVALID_RESPONSE");
      return {
        voiceId,
        status: response.data.status === "processing" ? "processing" : "ready",
      };
    } catch (error) {
      if (error?.code?.startsWith?.("VOICE_PROVIDER_")) throw error;
      throw providerError();
    }
  }

  async generateSpeech({ voiceId, text, language, settings }) {
    this.assertConfigured();
    try {
      const response = await this.client.post(
        `${this.serviceUrl}/v1/voices/${encodeURIComponent(voiceId)}/speech`,
        { text, language, settings },
        { responseType: "arraybuffer", timeout: this.timeoutMs, maxContentLength: 25 * 1024 * 1024 },
      );
      const buffer = Buffer.from(response.data);
      if (!buffer.length) throw providerError("VOICE_PROVIDER_INVALID_RESPONSE");
      return { buffer, mimeType: String(response.headers?.["content-type"] || "audio/wav").split(";")[0] };
    } catch (error) {
      if (error?.code?.startsWith?.("VOICE_PROVIDER_")) throw error;
      throw providerError();
    }
  }

  async getStatus({ voiceId }) {
    this.assertConfigured();
    try {
      const response = await this.client.get(
        `${this.serviceUrl}/v1/voices/${encodeURIComponent(voiceId)}`,
        { timeout: 15_000 },
      );
      const status = response?.data?.status;
      return { status: ["processing", "ready", "failed"].includes(status) ? status : "failed" };
    } catch {
      throw providerError();
    }
  }

  async deleteVoice({ voiceId }) {
    this.assertConfigured();
    try {
      await this.client.delete(
        `${this.serviceUrl}/v1/voices/${encodeURIComponent(voiceId)}`,
        { timeout: 30_000 },
      );
      return { deleted: true };
    } catch {
      throw providerError();
    }
  }
}
