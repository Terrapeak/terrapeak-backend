import { randomUUID } from "node:crypto";
import BaseVoiceProvider from "./baseVoiceProvider.js";

const WAV_HEADER = Buffer.from("524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex");

export default class MockVoiceProvider extends BaseVoiceProvider {
  constructor({ failCreate = false, failGenerate = false, failDelete = false, initialStatus = "ready" } = {}) {
    super({ name: "mock" });
    this.failCreate = failCreate;
    this.failGenerate = failGenerate;
    this.failDelete = failDelete;
    this.initialStatus = initialStatus;
    this.voices = new Map();
    this.calls = { create: 0, generate: 0, status: 0, delete: 0 };
  }

  async createVoice() {
    this.calls.create += 1;
    if (this.failCreate) throw new Error("simulated provider creation failure");
    const voiceId = `mock-${randomUUID()}`;
    this.voices.set(voiceId, this.initialStatus);
    return { voiceId, status: this.initialStatus };
  }

  async generateSpeech({ voiceId }) {
    this.calls.generate += 1;
    if (this.failGenerate || this.voices.get(voiceId) !== "ready") {
      throw new Error("simulated provider generation failure");
    }
    return { buffer: WAV_HEADER, mimeType: "audio/wav" };
  }

  async getStatus({ voiceId }) {
    this.calls.status += 1;
    return { status: this.voices.get(voiceId) || "failed" };
  }

  async deleteVoice({ voiceId }) {
    this.calls.delete += 1;
    if (this.failDelete) throw new Error("simulated provider deletion failure");
    this.voices.delete(voiceId);
    return { deleted: true };
  }
}
