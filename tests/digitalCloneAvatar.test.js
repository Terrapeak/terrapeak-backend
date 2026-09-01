import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneGeneration from "../models/digitalCloneGeneration.js";
import DigitalCloneAvatar from "../models/digitalCloneAvatar.js";
import DigitalCloneAvatarCandidate from "../models/digitalCloneAvatarCandidate.js";
import DigitalCloneAvatarVideo from "../models/digitalCloneAvatarVideo.js";
import MockAvatarProvider from "../providers/digitalCloneAvatar/mockAvatarProvider.js";
import { DIGITAL_CLONE_AVATAR_RATE_LIMITS } from "../middleware/digitalCloneAvatarRateLimit.js";
import { assertHeyGenMediaUrl, copyProviderVideoToPrivateStorage, readBoundedResponse, streamHeyGenPreview } from "../services/digitalCloneAvatarStorageService.js";
import {
  acceptAvatarConsent, approveAvatarVideo, assertAvatarConsent, createAvatarVideo, discoverAvatars,
  getAvatarPreviewDelivery, getAvatarState, getAvatarVideoDelivery, refreshAvatarVideo, rejectAvatarVideo,
  revokeAvatar, selectAvatar,
} from "../services/digitalCloneAvatarService.js";

const COMPANY_ID = new mongoose.Types.ObjectId();
const OTHER_COMPANY_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();
const consentBody = { appearanceOwnershipOrAuthorization: true, avatarGenerationAuthorized: true, providerProcessingAuthorized: true, revocationUnderstood: true };
let mongo;

const createProfile = ({ companyId = COMPANY_ID, userId = USER_ID } = {}) => DigitalCloneProfile.create({ companyId, userId, status: "consented", consent: { identityConfirmed: true, mediaRightsConfirmed: true, aiRepresentationConsent: true, acceptedAt: new Date() } });
const authorize = async (scope = {}) => { await createProfile(scope); return acceptAvatarConsent({ companyId: scope.companyId || COMPANY_ID, userId: scope.userId || USER_ID, body: consentBody, acceptedIp: "127.0.0.1" }); };
const prepareSelection = async ({ companyId = COMPANY_ID, userId = USER_ID, provider = new MockAvatarProvider() } = {}) => { await authorize({ companyId, userId }); const candidates = await discoverAvatars({ companyId, userId, provider }); await selectAvatar({ companyId, userId, candidateId: candidates[0]._id, provider }); return { candidate: candidates[0], provider }; };
const approvedDraft = () => DigitalCloneGeneration.create({ companyId: COMPANY_ID, userId: USER_ID, contentType: "short-video-script", topic: "Launch", length: "short", originalGeneratedText: "Original", currentText: "Approved script", finalApprovedText: "Approved script", status: "approved", approvedAt: new Date() });
const mp4 = () => { const value = Buffer.alloc(24); value.writeUInt32BE(24, 0); value.write("ftyp", 4); value.write("mp42", 8); return value; };

before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Promise.all([DigitalCloneAvatar.syncIndexes(), DigitalCloneAvatarCandidate.syncIndexes(), DigitalCloneAvatarVideo.syncIndexes()]); });
beforeEach(async () => { await Promise.all([DigitalCloneProfile.deleteMany({}), DigitalCloneGeneration.deleteMany({}), DigitalCloneAvatar.deleteMany({}), DigitalCloneAvatarCandidate.deleteMany({}), DigitalCloneAvatarVideo.deleteMany({})]); });
after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test("avatar authorization requires current base consent and all explicit affirmations", async () => {
  await assert.rejects(acceptAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID, body: consentBody }), (error) => error.code === "DIGITAL_CLONE_AVATAR_BASE_CONSENT_REQUIRED");
  await createProfile();
  await assert.rejects(acceptAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID, body: { ...consentBody, providerProcessingAuthorized: false } }), (error) => error.code === "AVATAR_CONSENT_REQUIRED");
  const setup = await acceptAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID, body: consentBody, acceptedIp: "127.0.0.1" });
  assert.ok(setup.consent.acceptedAt);
  await assert.doesNotReject(assertAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID }));
});

test("discovery stores private provider references but returns safe candidates", async () => {
  const { candidate, provider } = await prepareSelection();
  assert.equal(candidate.providerAvatarLookRef, undefined);
  const stored = await DigitalCloneAvatarCandidate.findById(candidate._id).select("+provider +providerAvatarGroupRef +providerAvatarLookRef +previewImageUrl");
  assert.equal(stored.provider, "mock");
  const state = await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID, provider: new MockAvatarProvider() });
  assert.equal(state.availableAvatars[0].displayName, "Private Test Avatar");
  assert.equal("providerAvatarLookRef" in state.availableAvatars[0], false);
  assert.match(state.availableAvatars[0].previewPath, /^\/digital-clone\/avatar\/available\//);
  for (let attempt = 0; attempt < 10; attempt += 1) await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal((await DigitalCloneAvatarCandidate.findById(candidate._id)).status, "selected");
});

test("discovery deduplicates repeated provider looks without merging distinct looks", async () => {
  await authorize();
  const shared = { groupRef: "group-one", lookRef: "look-one", defaultVoiceRef: "voice-one", displayName: "First", avatarType: "photo-avatar", orientation: "portrait", supportedCapabilities: ["avatar_v"], previewImageUrl: "https://files.heygen.ai/one.jpg", ready: true };
  const provider = new MockAvatarProvider({ avatars: [shared, { ...shared, displayName: "Latest duplicate" }, { ...shared, lookRef: "look-two", displayName: "Distinct look" }] });
  const candidates = await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal(candidates.length, 2);
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.displayName)), new Set(["Latest duplicate", "Distinct look"]));
  assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: COMPANY_ID, userId: USER_ID }), 2);
});

test("existing production-style candidate and ten rediscoveries remain one updated candidate", async () => {
  await authorize(); const provider = new MockAvatarProvider(); const value = provider.avatars[0];
  const providerKeyHash = createHash("sha256").update(`${provider.name}:${value.groupRef}:${value.lookRef}`).digest("hex");
  const existing = await DigitalCloneAvatarCandidate.create({ companyId: COMPANY_ID, userId: USER_ID, provider: provider.name, providerKeyHash, providerAvatarGroupRef: value.groupRef, providerAvatarLookRef: value.lookRef, providerDefaultVoiceRef: value.defaultVoiceRef, previewImageUrl: value.previewImageUrl, displayName: "Existing candidate", avatarType: value.avatarType, orientation: value.orientation, supportedCapabilities: value.supportedCapabilities, providerReady: true, status: "discovered", lastDiscoveredAt: new Date("2025-01-01") });
  for (let attempt = 0; attempt < 10; attempt += 1) await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
  const candidates = await DigitalCloneAvatarCandidate.find({ companyId: COMPANY_ID, userId: USER_ID });
  assert.equal(candidates.length, 1);
  assert.equal(String(candidates[0]._id), String(existing._id));
  assert.equal(candidates[0].displayName, "Private Test Avatar");
});

test("concurrent discovery reconciles one canonical candidate without duplicate-key failure", async () => {
  await authorize(); const provider = new MockAvatarProvider();
  const results = await Promise.all(Array.from({ length: 10 }, () => discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider })));
  assert.ok(results.every((candidates) => candidates.length === 1));
  assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: COMPANY_ID, userId: USER_ID }), 1);
});

test("canonical unique-index race re-reads the existing candidate without exposing E11000", async () => {
  await authorize(); const provider = new MockAvatarProvider();
  await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
  const original = DigitalCloneAvatarCandidate.findOneAndUpdate; let injected = false;
  DigitalCloneAvatarCandidate.findOneAndUpdate = function findOneAndUpdate(filter, update, options) {
    if (options?.upsert && !injected) {
      injected = true; const error = new Error("duplicate identity"); error.code = 11000; error.keyPattern = { companyId: 1, userId: 1, providerKeyHash: 1 };
      return Promise.reject(error);
    }
    return original.call(this, filter, update, options);
  };
  try {
    const candidates = await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
    assert.equal(candidates.length, 1);
    assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: COMPANY_ID, userId: USER_ID }), 1);
  } finally { DigitalCloneAvatarCandidate.findOneAndUpdate = original; }
});

test("discovery identity remains isolated by both company and user", async () => {
  const provider = new MockAvatarProvider();
  await authorize(); await authorize({ companyId: COMPANY_ID, userId: OTHER_USER_ID }); await authorize({ companyId: OTHER_COMPANY_ID, userId: USER_ID });
  await Promise.all([
    discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider }),
    discoverAvatars({ companyId: COMPANY_ID, userId: OTHER_USER_ID, provider }),
    discoverAvatars({ companyId: OTHER_COMPANY_ID, userId: USER_ID, provider }),
  ]);
  assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: COMPANY_ID, userId: USER_ID }), 1);
  assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: COMPANY_ID, userId: OTHER_USER_ID }), 1);
  assert.equal(await DigitalCloneAvatarCandidate.countDocuments({ companyId: OTHER_COMPANY_ID, userId: USER_ID }), 1);
});

test("not-ready avatars and arbitrary or cross-tenant IDs cannot be selected", async () => {
  await authorize();
  const provider = new MockAvatarProvider({ avatars: [{ groupRef: "g", lookRef: "l", displayName: "Training", avatarType: "unknown", orientation: "unknown", supportedCapabilities: [], ready: false }] });
  const [candidate] = await discoverAvatars({ companyId: COMPANY_ID, userId: USER_ID, provider });
  await assert.rejects(selectAvatar({ companyId: COMPANY_ID, userId: USER_ID, candidateId: candidate._id, provider }), (error) => error.code === "AVATAR_NOT_READY");
  await authorize({ companyId: OTHER_COMPANY_ID, userId: OTHER_USER_ID });
  await assert.rejects(selectAvatar({ companyId: OTHER_COMPANY_ID, userId: OTHER_USER_ID, candidateId: candidate._id, provider }), (error) => error.code === "AVATAR_NOT_FOUND");
  await assert.rejects(selectAvatar({ companyId: COMPANY_ID, userId: USER_ID, candidateId: new mongoose.Types.ObjectId(), provider }), (error) => error.code === "AVATAR_NOT_FOUND");
});

test("generation accepts only approved owned short-video drafts and deduplicates paid requests", async () => {
  const { provider } = await prepareSelection(); const draft = await approvedDraft();
  const body = { sourceType: "approved-draft", draftId: draft._id, aspectRatio: "9:16", resolution: "720p", captions: false, background: "default" };
  const first = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider });
  const second = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider });
  assert.equal(String(first._id), String(second._id));
  assert.equal(provider.calls.create, 1);
  await assert.rejects(createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { ...body, draftId: new mongoose.Types.ObjectId() }, provider }), (error) => ["DRAFT_NOT_APPROVED", "DRAFT_NOT_FOUND"].includes(error.code));
});

test("concurrent identical generation requests create exactly one paid provider job", async () => {
  const { provider } = await prepareSelection(); const body = { sourceType: "manual-test", script: "One atomic paid request" };
  const [first, second] = await Promise.all([
    createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider }),
    createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider }),
  ]);
  assert.equal(String(first._id), String(second._id));
  assert.equal(provider.calls.create, 1);
  assert.equal(await DigitalCloneAvatarVideo.countDocuments({ companyId: COMPANY_ID, userId: USER_ID }), 1);
});

test("manual scripts are strictly bounded and reject unexpected fields", async () => {
  const { provider } = await prepareSelection();
  await assert.rejects(createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "x".repeat(1201) }, provider }), (error) => error.code === "AVATAR_SCRIPT_TOO_LONG");
  await assert.rejects(createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "test", audioUrl: "https://attacker.test/a.mp3" }, provider }), (error) => error.code === "AVATAR_VIDEO_INVALID");
});

test("provider status completion is copied privately before it becomes deliverable", async () => {
  const { provider } = await prepareSelection();
  const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Short private test" }, provider });
  const stored = await DigitalCloneAvatarVideo.findById(video._id).select("+providerJobRef"); provider.complete(stored.providerJobRef);
  const completed = await refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, provider, copyVideo: async () => ({ public_id: "private-result", bytes: 24 }) });
  assert.equal(completed.status, "completed");
  assert.equal(completed.providerResultUrl, undefined);
  const delivery = await getAvatarVideoDelivery({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, streamVideo: async () => Readable.from([mp4()]) });
  assert.ok(delivery.stream);
});

test("provider failure, rejection, approval, readiness, and reconfirmation are safe", async () => {
  const { provider } = await prepareSelection();
  const failed = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Failure path" }, provider });
  let stored = await DigitalCloneAvatarVideo.findById(failed._id).select("+providerJobRef"); provider.fail(stored.providerJobRef);
  assert.equal((await refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: failed._id, provider })).status, "failed");
  const retried = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Failure path" }, provider });
  assert.notEqual(String(retried._id), String(failed._id));
  assert.equal((await rejectAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: failed._id })).status, "rejected");
  const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Approval path" }, provider });
  stored = await DigitalCloneAvatarVideo.findById(video._id).select("+providerJobRef"); provider.complete(stored.providerJobRef);
  await refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, provider, copyVideo: async () => ({ public_id: "private-approved", bytes: 24 }) });
  await approveAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id });
  assert.equal((await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID, provider })).avatar.readiness.ready, true);
  await acceptAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID, body: consentBody });
  assert.equal((await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID, provider })).avatar.readiness.ready, true);
});

test("completed requests stay deduplicated until rejection, then permit one retry", async () => {
  const { provider } = await prepareSelection(); const body = { sourceType: "manual-test", script: "Reject and retry" };
  const first = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider });
  const stored = await DigitalCloneAvatarVideo.findById(first._id).select("+providerJobRef"); provider.complete(stored.providerJobRef);
  await refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: first._id, provider, copyVideo: async () => ({ public_id: "private-rejected", bytes: 24 }) });
  const duplicate = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider });
  assert.equal(String(duplicate._id), String(first._id));
  await rejectAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: first._id });
  const retry = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body, provider });
  assert.notEqual(String(retry._id), String(first._id));
  assert.equal(provider.calls.create, 2);
});

test("provider-unconfigured state loads safely without mock fallback or readiness", async () => {
  const previousProvider = process.env.DIGITAL_CLONE_AVATAR_PROVIDER; const previousKey = process.env.HEYGEN_API_KEY;
  delete process.env.DIGITAL_CLONE_AVATAR_PROVIDER; delete process.env.HEYGEN_API_KEY;
  try {
    const state = await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID });
    assert.deepEqual(state.providerAvailability, { available: false, code: "AVATAR_PROVIDER_NOT_CONFIGURED" });
    assert.equal(state.avatar.readiness.ready, false);
    assert.ok(state.avatar.readiness.reasons.includes("provider-unavailable"));
  } finally {
    if (previousProvider === undefined) delete process.env.DIGITAL_CLONE_AVATAR_PROVIDER; else process.env.DIGITAL_CLONE_AVATAR_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = previousKey;
  }
});

test("base-consent invalidation immediately hides identity state and clears readiness", async () => {
  const { provider } = await prepareSelection();
  await DigitalCloneProfile.updateOne({ companyId: COMPANY_ID, userId: USER_ID }, { $set: { "consent.aiRepresentationConsent": false } });
  const state = await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal(state.avatar.readiness.ready, false);
  assert.equal(state.avatar.selectedAvatarId, null);
  assert.deepEqual(state.availableAvatars, []);
  assert.deepEqual(state.videos, []);
});

test("revocation wins over in-flight result copying and archives approved output", async () => {
  const { provider } = await prepareSelection();
  const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Concurrent revoke" }, provider });
  const stored = await DigitalCloneAvatarVideo.findById(video._id).select("+providerJobRef"); provider.complete(stored.providerJobRef);
  let cleaned = false;
  await assert.rejects(refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, provider, copyVideo: async () => { await revokeAvatar({ companyId: COMPANY_ID, userId: USER_ID }); return { public_id: "orphaned-private-copy", bytes: 24 }; }, deleteVideo: async ({ storagePublicId }) => { assert.equal(storagePublicId, "orphaned-private-copy"); cleaned = true; } }), (error) => error.code === "AVATAR_AUTHORIZATION_CHANGED");
  assert.equal(cleaned, true);
  assert.equal((await DigitalCloneAvatarVideo.findById(video._id)).status, "archived");
});

test("revocation archives an approved result so reauthorization cannot expose it", async () => {
  const { provider } = await prepareSelection();
  const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Approved then revoked" }, provider });
  const stored = await DigitalCloneAvatarVideo.findById(video._id).select("+providerJobRef"); provider.complete(stored.providerJobRef);
  await refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, provider, copyVideo: async () => ({ public_id: "private-revoked", bytes: 24 }) });
  await approveAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id });
  await revokeAvatar({ companyId: COMPANY_ID, userId: USER_ID });
  assert.equal((await DigitalCloneAvatarVideo.findById(video._id)).status, "archived");
  await acceptAvatarConsent({ companyId: COMPANY_ID, userId: USER_ID, body: consentBody });
  await assert.rejects(getAvatarVideoDelivery({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, streamVideo: async () => Readable.from([]) }), (error) => error.code === "AVATAR_VIDEO_NOT_FOUND");
});

test("revocation immediately blocks polling, delivery, preview, and readiness", async () => {
  const { candidate, provider } = await prepareSelection();
  const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Will revoke" }, provider });
  await revokeAvatar({ companyId: COMPANY_ID, userId: USER_ID });
  await assert.rejects(refreshAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, provider }), (error) => error.code === "AVATAR_CONSENT_REQUIRED");
  await assert.rejects(getAvatarPreviewDelivery({ companyId: COMPANY_ID, userId: USER_ID, candidateId: candidate._id, streamPreview: async () => Readable.from([]) }), (error) => error.code === "AVATAR_CONSENT_REQUIRED");
  await assert.rejects(getAvatarVideoDelivery({ companyId: COMPANY_ID, userId: USER_ID, videoId: video._id, streamVideo: async () => Readable.from([]) }), (error) => error.code === "AVATAR_CONSENT_REQUIRED");
  assert.equal((await getAvatarState({ companyId: COMPANY_ID, userId: USER_ID, provider })).avatar.readiness.ready, false);
});

test("storage rejects SSRF targets and disguised non-MP4 responses", async () => {
  assert.throws(() => assertHeyGenMediaUrl("http://files.heygen.ai/video.mp4"), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  assert.throws(() => assertHeyGenMediaUrl("https://heygen.ai.attacker.test/video.mp4"), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  await assert.rejects(copyProviderVideoToPrivateStorage({ resultUrl: "https://files.heygen.ai/video.mp4", companyId: COMPANY_ID, userId: USER_ID, videoId: new mongoose.Types.ObjectId(), fetchVideo: async () => ({ data: Buffer.from("not mp4"), headers: { "content-type": "video/mp4" } }), uploadBuffer: async () => ({}) }), (error) => error.code === "AVATAR_VIDEO_DELIVERY_FAILED");
  const uploaded = await copyProviderVideoToPrivateStorage({ resultUrl: "https://files.heygen.ai/video.mp4", companyId: COMPANY_ID, userId: USER_ID, videoId: new mongoose.Types.ObjectId(), fetchVideo: async () => ({ data: mp4(), headers: { "content-type": "video/mp4" } }), uploadBuffer: async ({ buffer }) => ({ public_id: "private", bytes: buffer.length }) });
  assert.equal(uploaded.public_id, "private");
});

test("provider downloads disable redirects and enforce bounds while streaming", async () => {
  let options;
  const chunks = async function* () { yield Buffer.alloc(4); yield Buffer.alloc(4); };
  await assert.rejects(readBoundedResponse({ data: chunks(), headers: {} }, 7), /response too large/);
  await copyProviderVideoToPrivateStorage({ resultUrl: "https://files.heygen.ai/video.mp4", companyId: COMPANY_ID, userId: USER_ID, videoId: new mongoose.Types.ObjectId(), fetchVideo: async (_url, requestOptions) => { options = requestOptions; return { data: mp4(), headers: { "content-type": "video/mp4" } }; }, uploadBuffer: async () => ({ public_id: "private" }) });
  assert.equal(options.responseType, "stream");
  assert.equal(options.maxRedirects, 0);
});

test("status and video delivery are scoped to both company and user", async () => {
  const { provider } = await prepareSelection(); const video = await createAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, body: { sourceType: "manual-test", script: "Owned result" }, provider });
  await authorize({ companyId: COMPANY_ID, userId: OTHER_USER_ID });
  await assert.rejects(refreshAvatarVideo({ companyId: COMPANY_ID, userId: OTHER_USER_ID, videoId: video._id, provider }), (error) => error.code === "AVATAR_VIDEO_NOT_FOUND");
  await assert.rejects(getAvatarVideoDelivery({ companyId: COMPANY_ID, userId: OTHER_USER_ID, videoId: video._id, streamVideo: async () => Readable.from([]) }), (error) => error.code === "AVATAR_VIDEO_NOT_FOUND");
  await authorize({ companyId: OTHER_COMPANY_ID, userId: USER_ID });
  await assert.rejects(refreshAvatarVideo({ companyId: OTHER_COMPANY_ID, userId: USER_ID, videoId: video._id, provider }), (error) => error.code === "AVATAR_VIDEO_NOT_FOUND");
});

test("active dedupe index has legacy-safe partial semantics", () => {
  const [, options] = DigitalCloneAvatarVideo.schema.indexes().find(([keys]) => keys.activeDedupeKey === 1);
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, { activeDedupeKey: { $type: "string" } });
});

test("preview proxy validates image MIME and signature before delivery", async () => {
  await assert.rejects(streamHeyGenPreview({ previewUrl: "https://files.heygen.ai/preview.jpg", fetchPreview: async () => ({ data: Buffer.from("not an image"), headers: { "content-type": "image/jpeg" } }) }), (error) => error.code === "AVATAR_PREVIEW_UNAVAILABLE");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const result = await streamHeyGenPreview({ previewUrl: "https://files.heygen.ai/preview.jpg", fetchPreview: async () => ({ data: jpeg, headers: { "content-type": "image/jpeg" } }) });
  assert.equal(result.mimeType, "image/jpeg");
  assert.ok(result.stream);
});

test("avatar rate-limit defaults control discovery, polling, and paid generation", () => {
  assert.deepEqual(DIGITAL_CLONE_AVATAR_RATE_LIMITS, { discoveryPer15Minutes: 10, generationPerHour: 3, statusPer15Minutes: 120 });
});
