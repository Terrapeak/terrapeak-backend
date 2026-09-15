import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import DigitalCloneAvatar from "../models/digitalCloneAvatar.js";
import DigitalCloneAvatarCandidate from "../models/digitalCloneAvatarCandidate.js";
import DigitalCloneAvatarProviderVoice from "../models/digitalCloneAvatarProviderVoice.js";
import DigitalCloneAvatarVideo from "../models/digitalCloneAvatarVideo.js";
import DigitalCloneBrainProfile from "../models/digitalCloneBrainProfile.js";
import DigitalCloneGeneration from "../models/digitalCloneGeneration.js";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneTestClone from "../models/digitalCloneTestClone.js";
import MockAvatarProvider from "../providers/digitalCloneAvatar/mockAvatarProvider.js";
import {
  acceptAvatarConsent, approveAvatarVideo, createAvatarVideo, discoverAvatarProviderVoices, discoverAvatars,
  refreshAvatarVideo, selectAvatar, selectAvatarProviderVoice,
} from "../services/digitalCloneAvatarService.js";
import {
  approveTestCloneScript, approveTestCloneVideo, createTestCloneFromApprovedDraft, deliverTestCloneVideo,
  editTestCloneScript, generateTestCloneScript, generateTestCloneVideo, getTestCloneState,
  refreshTestCloneVideo, rejectTestCloneVideo,
} from "../services/digitalCloneTestCloneService.js";

const COMPANY_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const OTHER_COMPANY_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();
const consent = { appearanceOwnershipOrAuthorization: true, avatarGenerationAuthorized: true, providerProcessingAuthorized: true, revocationUnderstood: true };
const readyBrain = {
  expertiseSummary: "Practical AI adoption for SMEs.", expertiseAreas: ["AI adoption"], industries: ["Technology"], markets: ["Singapore"], traits: ["Practical"],
  formality: 3, detailLevel: 4, energy: 3, storytelling: 4, technicality: 2, communicationDescription: "Clear and useful.", speakingPace: "moderate",
  preferredPhrases: ["Start small"], avoidedPhrases: ["Synergy"], writingRules: ["Use short paragraphs"], viewpoints: [{ topic: "AI", position: "Start with one workflow." }],
  stories: [{ title: "First workflow", summary: "A measured workflow reduced admin.", tags: ["AI"] }], avoidTopics: ["medical diagnosis"], prohibitedClaims: ["Guaranteed outcomes"], status: "ready",
};
let mongo;

const createBase = async ({ companyId = COMPANY_ID, userId = USER_ID, brain = true } = {}) => {
  await DigitalCloneProfile.create({ companyId, userId, status: "consented", displayName: "Ray", bio: "Operator", expertise: ["AI"], consent: { identityConfirmed: true, mediaRightsConfirmed: true, aiRepresentationConsent: true, acceptedAt: new Date() } });
  if (brain) await DigitalCloneBrainProfile.create({ companyId, userId, ...readyBrain });
};

const prepareReady = async ({ companyId = COMPANY_ID, userId = USER_ID, provider = new MockAvatarProvider() } = {}) => {
  await createBase({ companyId, userId });
  await acceptAvatarConsent({ companyId, userId, body: consent, acceptedIp: "127.0.0.1" });
  const candidates = await discoverAvatars({ companyId, userId, provider });
  await selectAvatar({ companyId, userId, candidateId: candidates[0]._id, provider });
  const voices = await discoverAvatarProviderVoices({ companyId, userId, provider });
  await selectAvatarProviderVoice({ companyId, userId, voiceId: voices[0]._id, provider });
  const validation = await createAvatarVideo({ companyId, userId, body: { sourceType: "manual_test", script: "Step 5 validation" }, provider });
  const stored = await DigitalCloneAvatarVideo.findById(validation._id).select("+providerJobRef");
  provider.complete(stored.providerJobRef);
  await refreshAvatarVideo({ companyId, userId, videoId: validation._id, provider, copyVideo: async () => ({ public_id: `validation-${validation._id}`, bytes: 24 }) });
  await approveAvatarVideo({ companyId, userId, videoId: validation._id });
  return { provider, candidateId: candidates[0]._id, voiceId: voices[0]._id, validationId: validation._id };
};

const textProvider = async () => ({ text: JSON.stringify({ hook: "A practical start", script: "Choose one useful workflow.", closingCta: "What will you test?" }), model: "mock" });
const company = { _id: COMPANY_ID, contentStudioAiConfig: { geminiKey: "local-test-key" } };

before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Promise.all([DigitalCloneAvatar.syncIndexes(), DigitalCloneAvatarCandidate.syncIndexes(), DigitalCloneAvatarProviderVoice.syncIndexes(), DigitalCloneAvatarVideo.syncIndexes(), DigitalCloneTestClone.syncIndexes()]); });
beforeEach(async () => { await Promise.all([DigitalCloneProfile.deleteMany({}), DigitalCloneBrainProfile.deleteMany({}), DigitalCloneGeneration.deleteMany({}), DigitalCloneAvatar.deleteMany({}), DigitalCloneAvatarCandidate.deleteMany({}), DigitalCloneAvatarProviderVoice.deleteMany({}), DigitalCloneAvatarVideo.deleteMany({}), DigitalCloneTestClone.deleteMany({})]); });
after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test("Step 8 reports controlled prerequisite states and does not require TerraPeak Voice", async () => {
  let state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: new MockAvatarProvider() });
  assert.equal(state.prerequisites.ready, false);
  assert.ok(state.prerequisites.needs.every((value) => !value.includes("provider-") && !value.includes("reason")));
  await createBase({ brain: false });
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: new MockAvatarProvider() });
  assert.equal(state.prerequisites.brainReady, false);
  await Promise.all([DigitalCloneProfile.deleteMany({}), DigitalCloneBrainProfile.deleteMany({})]);
  const ready = await prepareReady();
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: ready.provider });
  assert.equal(state.prerequisites.ready, true);
  assert.equal(state.configuration.status, "Ready");
  assert.equal(JSON.stringify(state).includes("providerVoiceRef"), false);
});

test("new prompt generation validates bounds, reuses Generate as Me, and never calls the Avatar provider", async () => {
  const { provider } = await prepareReady();
  await assert.rejects(generateTestCloneScript({ company, userId: USER_ID, body: { prompt: " " }, textProvider, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_PROMPT_REQUIRED");
  await assert.rejects(generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "x".repeat(1001) }, textProvider, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_PROMPT_TOO_LONG");
  const paidCalls = provider.calls.create;
  const record = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a short LinkedIn video" }, textProvider, avatarProvider: provider });
  assert.equal(record.sourceType, "new-prompt");
  assert.match(record.scriptText, /useful workflow/);
  assert.equal(provider.calls.create, paidCalls);
  assert.equal(await DigitalCloneGeneration.countDocuments({}), 0);
});

test("approved draft loading is scoped, approved, supported, active, and bounded", async () => {
  const { provider } = await prepareReady();
  const valid = await DigitalCloneGeneration.create({ companyId: COMPANY_ID, userId: USER_ID, contentType: "short-video-script", topic: "Valid", length: "short", originalGeneratedText: "Text", currentText: "Text", finalApprovedText: "Approved text", status: "approved", approvedAt: new Date() });
  const record = await createTestCloneFromApprovedDraft({ companyId: COMPANY_ID, userId: USER_ID, body: { draftId: valid._id }, avatarProvider: provider });
  assert.equal(record.scriptText, "Approved text");
  for (const bad of [
    { companyId: COMPANY_ID, userId: USER_ID, contentType: "short-video-script", status: "draft", text: "Draft" },
    { companyId: COMPANY_ID, userId: USER_ID, contentType: "linkedin-post", status: "approved", text: "Wrong type" },
    { companyId: COMPANY_ID, userId: OTHER_USER_ID, contentType: "short-video-script", status: "approved", text: "Other user" },
    { companyId: OTHER_COMPANY_ID, userId: USER_ID, contentType: "short-video-script", status: "approved", text: "Other company" },
    { companyId: COMPANY_ID, userId: USER_ID, contentType: "short-video-script", status: "archived", text: "Archived" },
  ]) {
    const draft = await DigitalCloneGeneration.create({ companyId: bad.companyId, userId: bad.userId, contentType: bad.contentType, topic: "Bad", length: "short", originalGeneratedText: bad.text, currentText: bad.text, finalApprovedText: bad.text, status: bad.status, approvedAt: new Date() });
    await assert.rejects(createTestCloneFromApprovedDraft({ companyId: COMPANY_ID, userId: USER_ID, body: { draftId: draft._id }, avatarProvider: provider }));
  }
});

test("script approval binds the exact version and an edit immediately invalidates it", async () => {
  const { provider } = await prepareReady();
  const record = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  const approved = await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, avatarProvider: provider });
  assert.equal(approved.scriptApprovedHash, approved.scriptHash);
  const edited = await editTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { script: `${record.scriptText} Human edit.` } });
  assert.equal(edited.scriptVersion, 2);
  assert.equal(edited.scriptApprovedAt, null);
  assert.equal(edited.status, "script-draft");
});

test("paid generation requires approval, validates settings, rejects provider injection, and deduplicates double clicks", async () => {
  const { provider } = await prepareReady();
  const record = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  await assert.rejects(generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "default" }, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_SCRIPT_APPROVAL_REQUIRED");
  await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, avatarProvider: provider });
  await assert.rejects(generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { aspectRatio: "square", resolution: "720p", captions: false, background: "default" }, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_SETTINGS_INVALID");
  await assert.rejects(generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "default", providerVoiceId: "injected" }, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_INVALID_REQUEST");
  const first = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "default" }, avatarProvider: provider });
  const second = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "default" }, avatarProvider: provider });
  assert.equal(String(first._id), String(second._id));
  assert.equal(provider.calls.create, 2); // one Step 5 validation and one Step 8 generation
  assert.equal(provider.lastCreateInput.voice.voiceRef, "mock-provider-voice");
  assert.equal("providerVoiceId" in provider.lastCreateInput, false);
  const video = await DigitalCloneAvatarVideo.findById(first.avatarVideoId);
  assert.equal(video.purpose, "test-clone");
});

test("status completion stays not ready until explicit final approval", async () => {
  const { provider } = await prepareReady();
  const script = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  const processing = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, body: { aspectRatio: "9:16", resolution: "720p", captions: true, background: "default" }, avatarProvider: provider });
  await assert.rejects(approveTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_VIDEO_NOT_FOUND");
  let state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, false);
  const video = await DigitalCloneAvatarVideo.findById(processing.avatarVideoId).select("+providerJobRef");
  provider.complete(video.providerJobRef);
  const completed = await refreshTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider, copyVideo: async () => ({ public_id: `test-clone-${script._id}`, bytes: 24 }) });
  assert.equal(completed.status, "completed");
  await DigitalCloneTestClone.updateOne({ _id: script._id }, { $set: { generatedScriptHash: "f".repeat(64) } });
  await assert.rejects(approveTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_VIDEO_NOT_APPROVABLE");
  await DigitalCloneTestClone.updateOne({ _id: script._id }, { $set: { generatedScriptHash: completed.scriptHash } });
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, false);
  const approved = await approveTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  assert.equal(approved.status, "approved");
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, true);
  await rejectTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id });
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, false);
});

test("approval fails closed for stale configuration, consent, ownership, and script binding", async () => {
  const { provider } = await prepareReady();
  const record = await DigitalCloneTestClone.create({ companyId: COMPANY_ID, userId: USER_ID, sourceType: "new-prompt", originalPrompt: "Prompt", scriptText: "Approved", scriptHash: "a".repeat(64), scriptVersion: 1, scriptApprovedHash: "a".repeat(64), scriptApprovedAt: new Date(), scriptApprovedBy: USER_ID, generatedScriptHash: "b".repeat(64), status: "completed" });
  await assert.rejects(approveTestCloneVideo({ companyId: COMPANY_ID, userId: OTHER_USER_ID, testCloneId: record._id, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_NOT_FOUND");
  await DigitalCloneProfile.updateOne({ companyId: COMPANY_ID, userId: USER_ID }, { $set: { "consent.aiRepresentationConsent": false } });
  await assert.rejects(approveTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: record._id, avatarProvider: provider }), (error) => error.code === "TEST_CLONE_PREREQUISITES_REQUIRED");
});

test("rejection preserves Step 5 readiness and allows a separate future workflow", async () => {
  const { provider } = await prepareReady();
  const script = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  const processing = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, body: { aspectRatio: "16:9", resolution: "720p", captions: false, background: "light" }, avatarProvider: provider });
  const video = await DigitalCloneAvatarVideo.findById(processing.avatarVideoId).select("+providerJobRef"); provider.complete(video.providerJobRef);
  await refreshTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider, copyVideo: async () => ({ public_id: "rejected-private", bytes: 24 }) });
  const rejected = await rejectTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id });
  assert.equal(rejected.status, "rejected");
  const setup = await DigitalCloneAvatar.findOne({ companyId: COMPANY_ID, userId: USER_ID });
  assert.equal(setup.status, "ready");
  const next = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Try another" }, textProvider, avatarProvider: provider });
  assert.notEqual(String(next._id), String(rejected._id));
});

test("private delivery and records enforce company/user/purpose boundaries without provider leakage", async () => {
  const { provider } = await prepareReady();
  const script = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  const processing = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "dark" }, avatarProvider: provider });
  const video = await DigitalCloneAvatarVideo.findById(processing.avatarVideoId).select("+providerJobRef"); provider.complete(video.providerJobRef);
  await refreshTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider, copyVideo: async () => ({ public_id: "secure-private", bytes: 24 }) });
  await assert.rejects(deliverTestCloneVideo({ companyId: COMPANY_ID, userId: OTHER_USER_ID, testCloneId: script._id }), (error) => error.code === "TEST_CLONE_NOT_FOUND");
  await assert.rejects(deliverTestCloneVideo({ companyId: OTHER_COMPANY_ID, userId: USER_ID, testCloneId: script._id }), (error) => error.code === "TEST_CLONE_NOT_FOUND");
  const delivered = await deliverTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, streamVideo: async () => Readable.from([Buffer.from("video")]) });
  assert.ok(delivered.stream);
  const state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(JSON.stringify(state).includes("providerJobRef"), false);
  await assert.rejects(approveAvatarVideo({ companyId: COMPANY_ID, userId: USER_ID, videoId: processing.avatarVideoId }), (error) => error.code === "AVATAR_VIDEO_NOT_APPROVABLE");
});

test("approved readiness invalidates when Avatar configuration or consent changes but history remains", async () => {
  const { provider } = await prepareReady();
  const script = await generateTestCloneScript({ company, userId: USER_ID, body: { prompt: "Create a video" }, textProvider, avatarProvider: provider });
  await approveTestCloneScript({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  const processing = await generateTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, body: { aspectRatio: "9:16", resolution: "720p", captions: false, background: "default" }, avatarProvider: provider });
  const video = await DigitalCloneAvatarVideo.findById(processing.avatarVideoId).select("+providerJobRef"); provider.complete(video.providerJobRef);
  await refreshTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider, copyVideo: async () => ({ public_id: "approved-private", bytes: 24 }) });
  await approveTestCloneVideo({ companyId: COMPANY_ID, userId: USER_ID, testCloneId: script._id, avatarProvider: provider });
  await DigitalCloneAvatarVideo.updateOne({ _id: processing.avatarVideoId }, { $set: { status: "rejected" } });
  let state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, false);
  await DigitalCloneAvatarVideo.updateOne({ _id: processing.avatarVideoId }, { $set: { status: "completed" } });
  await DigitalCloneAvatar.updateOne({ companyId: COMPANY_ID, userId: USER_ID }, { $set: { approvedVideoId: new mongoose.Types.ObjectId() } });
  state = await getTestCloneState({ companyId: COMPANY_ID, userId: USER_ID, avatarProvider: provider });
  assert.equal(state.readiness.ready, false);
  assert.equal(state.history.some((item) => item.status === "approved"), true);
});
