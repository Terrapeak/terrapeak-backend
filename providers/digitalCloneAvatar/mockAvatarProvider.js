import { randomUUID } from "node:crypto";
import BaseAvatarProvider from "./baseAvatarProvider.js";

export default class MockAvatarProvider extends BaseAvatarProvider {
  constructor({ avatars, failList = false, failCreate = false, failStatus = false } = {}) {
    super({ name: "mock" });
    this.avatars = avatars || [{ groupRef: "mock-group", lookRef: "mock-look", defaultVoiceRef: "mock-default-voice", displayName: "Private Test Avatar", avatarType: "photo-avatar", orientation: "portrait", supportedCapabilities: ["avatar_v", "avatar_iv"], previewImageUrl: "https://files.heygen.ai/mock-preview.jpg", ready: true }];
    this.failList = failList; this.failCreate = failCreate; this.failStatus = failStatus; this.jobs = new Map(); this.calls = { list: 0, get: 0, create: 0, status: 0 };
  }
  assertConfigured() {}
  async listAvatars() { this.calls.list += 1; if (this.failList) throw new Error("mock list failure"); return this.avatars; }
  async getAvatar({ groupRef, lookRef }) { this.calls.get += 1; const item = this.avatars.find((avatar) => avatar.groupRef === groupRef && avatar.lookRef === lookRef); if (!item) { const error = new Error("missing"); error.code = "AVATAR_NOT_FOUND"; error.statusCode = 404; throw error; } return item; }
  async createVideo() { this.calls.create += 1; if (this.failCreate) throw new Error("mock create failure"); const jobRef = `mock-${randomUUID()}`; this.jobs.set(jobRef, { status: "processing" }); return { jobRef, status: "processing" }; }
  complete(jobRef) { this.jobs.set(jobRef, { status: "completed", resultUrl: "https://files.heygen.ai/mock-result.mp4", durationSeconds: 12 }); }
  fail(jobRef) { this.jobs.set(jobRef, { status: "failed", failureCode: "mock_failure" }); }
  async getVideoStatus({ jobRef }) { this.calls.status += 1; if (this.failStatus) throw new Error("mock status failure"); return this.jobs.get(jobRef) || { status: "failed", failureCode: "not_found" }; }
}
