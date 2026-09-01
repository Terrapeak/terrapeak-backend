import { randomUUID } from "node:crypto";
import BaseAvatarProvider from "./baseAvatarProvider.js";

export default class MockAvatarProvider extends BaseAvatarProvider {
  constructor({ avatars, voices, failList = false, failVoiceList = false, failCreate = false, failStatus = false } = {}) {
    super({ name: "mock" });
    this.avatars = avatars || [{ groupRef: "mock-group", lookRef: "mock-look", defaultVoiceRef: "mock-default-voice", displayName: "Private Test Avatar", avatarType: "photo-avatar", orientation: "portrait", supportedCapabilities: ["avatar_v", "avatar_iv"], previewImageUrl: "https://files.heygen.ai/mock-preview.jpg", ready: true }];
    this.voices = voices || [{ voiceRef: "mock-provider-voice", displayName: "Calm narrator", language: "English", gender: "neutral", voiceType: "public", ready: true }];
    this.failList = failList; this.failVoiceList = failVoiceList; this.failCreate = failCreate; this.failStatus = failStatus; this.jobs = new Map(); this.calls = { list: 0, get: 0, listVoices: 0, getVoice: 0, create: 0, status: 0 }; this.lastCreateInput = null;
  }
  assertConfigured() {}
  async listAvatars() { this.calls.list += 1; if (this.failList) throw new Error("mock list failure"); return this.avatars; }
  async getAvatar({ groupRef, lookRef }) { this.calls.get += 1; const item = this.avatars.find((avatar) => avatar.groupRef === groupRef && avatar.lookRef === lookRef); if (!item) { const error = new Error("missing"); error.code = "AVATAR_NOT_FOUND"; error.statusCode = 404; throw error; } return item; }
  async listVoices() { this.calls.listVoices += 1; if (this.failVoiceList) throw new Error("mock voice list failure"); return this.voices; }
  async getVoice({ voiceRef }) { this.calls.getVoice += 1; const item = this.voices.find((voice) => voice.voiceRef === voiceRef); if (!item) { const error = new Error("missing"); error.code = "AVATAR_PROVIDER_VOICE_NOT_FOUND"; error.statusCode = 404; throw error; } return item; }
  async createVideo(input) { this.calls.create += 1; this.lastCreateInput = input; if (this.failCreate) throw new Error("mock create failure"); const jobRef = `mock-${randomUUID()}`; this.jobs.set(jobRef, { status: "processing" }); return { jobRef, status: "processing" }; }
  complete(jobRef) { this.jobs.set(jobRef, { status: "completed", resultUrl: "https://files.heygen.ai/mock-result.mp4", durationSeconds: 12 }); }
  fail(jobRef) { this.jobs.set(jobRef, { status: "failed", failureCode: "mock_failure" }); }
  async getVideoStatus({ jobRef }) { this.calls.status += 1; if (this.failStatus) throw new Error("mock status failure"); return this.jobs.get(jobRef) || { status: "failed", failureCode: "not_found" }; }
}
