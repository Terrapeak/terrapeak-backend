import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneVoice from "../models/digitalCloneVoice.js";
import DigitalCloneVoicePreview from "../models/digitalCloneVoicePreview.js";
import DigitalCloneVoiceSample from "../models/digitalCloneVoiceSample.js";
import { ChatterboxVoiceProvider, MockVoiceProvider, resolveVoiceProvider } from "../providers/digitalCloneVoice/index.js";
import { DIGITAL_CLONE_VOICE_RATE_LIMITS } from "../middleware/digitalCloneVoiceRateLimit.js";
import { DIGITAL_CLONE_VOICE_UPLOAD_LIMITS } from "../middleware/digitalCloneVoiceUpload.js";
import {
  acceptVoiceConsent,
  approveVoice,
  assertVoiceConsent,
  calculateVoiceReadiness,
  createVoiceClone,
  deleteVoiceSample,
  generateVoicePreview,
  getApprovedVoiceForProvider,
  getVoicePreviewDelivery,
  getVoiceSampleDelivery,
  getVoiceState,
  listVoiceSamples,
  refreshVoiceStatus,
  revokeVoice,
  serializeVoice,
  updateVoiceSettings,
  uploadVoiceSamples,
  validateAudioSample,
} from "../services/digitalCloneVoiceService.js";

const COMPANY_ID = new mongoose.Types.ObjectId();
const OTHER_COMPANY_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();

let mongo;

const wavBuffer = (seconds = 1) => {
  const sampleRate = 8_000;
  const dataBytes = sampleRate * 2 * seconds;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
};

const voiceConsentBody = {
  voiceOwnershipOrAuthorization: true,
  processingAuthorized: true,
  generatedSpeechAuthorized: true,
  revocationUnderstood: true,
};

const createBaseProfile = ({ companyId = COMPANY_ID, userId = USER_ID } = {}) =>
  DigitalCloneProfile.create({
    companyId,
    userId,
    status: "consented",
    consent: {
      identityConfirmed: true,
      voiceRightsConfirmed: true,
      mediaRightsConfirmed: true,
      aiRepresentationConsent: true,
      version: "1.0",
      acceptedAt: new Date(),
    },
  });

const authorizeVoice = async ({ companyId = COMPANY_ID, userId = USER_ID } = {}) => {
  await createBaseProfile({ companyId, userId });
  return acceptVoiceConsent({ companyId, userId, body: voiceConsentBody, acceptedIp: "127.0.0.1" });
};

const uploadOneSample = ({ companyId = COMPANY_ID, userId = USER_ID } = {}) =>
  uploadVoiceSamples({
    companyId,
    userId,
    files: [{ buffer: wavBuffer(2), originalname: "my voice.wav", mimetype: "audio/wav" }],
    uploadAudio: async ({ buffer }) => ({ public_id: `private-sample-${companyId}-${userId}`, bytes: buffer.length }),
    destroyAudio: async () => {},
  });

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await Promise.all([
    DigitalCloneProfile.deleteMany({}),
    DigitalCloneVoice.deleteMany({}),
    DigitalCloneVoiceSample.deleteMany({}),
    DigitalCloneVoicePreview.deleteMany({}),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("explicit Voice Clone consent requires and persists all affirmations", async () => {
  await assert.rejects(
    acceptVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID, body: voiceConsentBody }),
    (error) => error.code === "DIGITAL_CLONE_BASE_VOICE_CONSENT_REQUIRED",
  );
  await createBaseProfile();
  await assert.rejects(
    acceptVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID, body: { ...voiceConsentBody, processingAuthorized: false } }),
    (error) => error.code === "VOICE_CONSENT_REQUIRED",
  );
  const voice = await acceptVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID, body: voiceConsentBody, acceptedIp: "127.0.0.1" });
  assert.equal(voice.consent.version, "1.0");
  assert.ok(voice.consent.acceptedAt);
  assert.equal(voice.consent.processingAuthorized, true);
  assert.equal(voice.consent.acceptedIp, "127.0.0.1");
  await assert.doesNotReject(assertVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID }));
});

test("reconfirming current voice consent preserves an existing ready voice", async () => {
  await authorizeVoice();
  await DigitalCloneVoice.updateOne(
    { companyId: COMPANY_ID, userId: USER_ID },
    { $set: { status: "ready", provider: "mock", providerVoiceId: "existing-provider-voice", approvedAt: new Date() } },
  );
  const reconfirmed = await acceptVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID, body: voiceConsentBody });
  const stored = await DigitalCloneVoice.findById(reconfirmed._id).select("+providerVoiceId +provider");
  assert.equal(stored.status, "ready");
  assert.equal(stored.providerVoiceId, "existing-provider-voice");
  assert.ok(stored.approvedAt);
});

test("audio validation rejects disguised, mismatched, and oversized files", () => {
  assert.throws(
    () => validateAudioSample({ buffer: Buffer.from("not audio content"), filename: "fake.wav", declaredMimeType: "audio/wav" }),
    (error) => error.code === "VOICE_SAMPLE_INVALID",
  );
  assert.throws(
    () => validateAudioSample({ buffer: wavBuffer(), filename: "fake.mp3", declaredMimeType: "audio/mpeg" }),
    (error) => error.code === "VOICE_SAMPLE_TYPE_MISMATCH",
  );
  assert.throws(
    () => validateAudioSample({ buffer: Buffer.alloc(25 * 1024 * 1024 + 1), filename: "large.wav", declaredMimeType: "audio/wav" }),
    (error) => error.code === "VOICE_SAMPLE_TOO_LARGE",
  );
});

test("upload and inference rate-limit defaults are bounded and configurable", () => {
  assert.deepEqual(DIGITAL_CLONE_VOICE_UPLOAD_LIMITS, {
    maxFilesPerRequest: 3,
    maxFileBytes: 25 * 1024 * 1024,
    maxActiveSamples: 10,
  });
  assert.deepEqual(DIGITAL_CLONE_VOICE_RATE_LIMITS, {
    uploadPer15Minutes: 10,
    createPerHour: 3,
    previewPer15Minutes: 10,
    concurrentUploadsPerInstance: 2,
  });
});

test("Chatterbox adapter targets only the configurable TerraPeak inference boundary", async () => {
  const requests = [];
  const client = {
    async post(url, body, options) {
      requests.push({ url, body, options });
      if (url.endsWith("/speech")) return { data: wavBuffer(), headers: { "content-type": "audio/wav" } };
      return { data: { voiceId: "chatterbox-voice-1", status: "ready" } };
    },
    async get() { return { data: { status: "ready" } }; },
    async delete() { return { data: {} }; },
  };
  const provider = new ChatterboxVoiceProvider({ serviceUrl: "http://voice.test/", client });
  const created = await provider.createVoice({
    samples: [{ buffer: wavBuffer(), filename: "voice.wav", mimeType: "audio/wav" }],
    language: "en",
    settings: { speakingPace: "moderate", expressiveness: 3 },
  });
  assert.equal(created.voiceId, "chatterbox-voice-1");
  assert.equal(requests[0].url, "http://voice.test/v1/voices");
  assert.ok(requests[0].body instanceof FormData);
  const generated = await provider.generateSpeech({
    voiceId: created.voiceId,
    text: "Test",
    language: "en",
    settings: { speakingPace: "moderate", expressiveness: 3 },
  });
  assert.equal(generated.mimeType, "audio/wav");
  assert.equal(requests[1].url, "http://voice.test/v1/voices/chatterbox-voice-1/speech");
});

test("missing or invalid provider configuration fails closed without leaving creation processing", async () => {
  const originalProvider = process.env.DIGITAL_CLONE_VOICE_PROVIDER;
  const originalUrl = process.env.CHATTERBOX_SERVICE_URL;
  delete process.env.DIGITAL_CLONE_VOICE_PROVIDER;
  delete process.env.CHATTERBOX_SERVICE_URL;
  try {
    await authorizeVoice();
    await uploadOneSample();
    await assert.rejects(
      createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, readSample: async () => wavBuffer() }),
      (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED" && error.statusCode === 503 && !/CHATTERBOX/.test(error.message),
    );
    assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).status, "samples_uploaded");
    const state = await getVoiceState({ companyId: COMPANY_ID, userId: USER_ID });
    assert.deepEqual(state.providerAvailability, { available: false, code: "VOICE_PROVIDER_NOT_CONFIGURED" });
    assert.equal(state.voice.readiness.ready, false);

    process.env.DIGITAL_CLONE_VOICE_PROVIDER = "unknown-provider";
    await assert.rejects(
      createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, readSample: async () => wavBuffer() }),
      (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED",
    );
    assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).status, "samples_uploaded");
  } finally {
    if (originalProvider === undefined) delete process.env.DIGITAL_CLONE_VOICE_PROVIDER;
    else process.env.DIGITAL_CLONE_VOICE_PROVIDER = originalProvider;
    if (originalUrl === undefined) delete process.env.CHATTERBOX_SERVICE_URL;
    else process.env.CHATTERBOX_SERVICE_URL = originalUrl;
  }
});

test("mock provider cannot be selected by runtime configuration and invalid Chatterbox URLs fail closed", () => {
  assert.throws(() => resolveVoiceProvider("mock"), (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED");
  assert.throws(
    () => new ChatterboxVoiceProvider({ serviceUrl: "file:///internal/voice" }).assertConfigured(),
    (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED",
  );
});

test("sample upload is consent-gated, normalized, private, and bounded", async () => {
  await createBaseProfile();
  await assert.rejects(uploadOneSample(), (error) => error.code === "VOICE_CONSENT_REQUIRED");
  await acceptVoiceConsent({ companyId: COMPANY_ID, userId: USER_ID, body: voiceConsentBody });
  const samples = await uploadOneSample();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].filename, "my-voice.wav");
  assert.equal(samples[0].durationSeconds, 2);
  assert.equal(samples[0].status, "active");
  const serialized = serializeVoice({
    _id: new mongoose.Types.ObjectId(),
    status: "samples_uploaded",
    voiceSettings: {},
    consent: voiceConsentBody,
  });
  assert.equal(serialized.providerVoiceId, undefined);
  assert.equal(serialized.providerDisplayName, "TerraPeak Voice");
});

test("concurrent sample uploads cannot exceed the atomic active-sample limit", async () => {
  await authorizeVoice();
  let storageSequence = 0;
  const uploadBatch = (batch) => uploadVoiceSamples({
    companyId: COMPANY_ID,
    userId: USER_ID,
    files: Array.from({ length: 3 }, (_value, index) => ({
      buffer: wavBuffer(),
      originalname: `voice-${batch}-${index}.wav`,
      mimetype: "audio/wav",
    })),
    uploadAudio: async ({ buffer }) => ({ public_id: `private-concurrent-${storageSequence += 1}`, bytes: buffer.length }),
    destroyAudio: async () => {},
  });
  const results = await Promise.allSettled([0, 1, 2, 3].map(uploadBatch));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "VOICE_SAMPLE_ACTIVE_LIMIT").length, 1);
  assert.equal(await DigitalCloneVoiceSample.countDocuments({ companyId: COMPANY_ID, userId: USER_ID, status: "active" }), 9);
  assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).activeSampleCount, 9);
});

test("sample delivery and deletion enforce company and user ownership", async () => {
  await authorizeVoice();
  await authorizeVoice({ companyId: COMPANY_ID, userId: OTHER_USER_ID });
  await authorizeVoice({ companyId: OTHER_COMPANY_ID, userId: USER_ID });
  const [sample] = await uploadOneSample();
  const delivered = await getVoiceSampleDelivery({
    companyId: COMPANY_ID,
    userId: USER_ID,
    sampleId: sample._id,
    streamAudio: async ({ storagePublicId }) => {
      assert.match(storagePublicId, /^private-sample-/);
      return Readable.from([Buffer.from("private audio")]);
    },
  });
  assert.equal(delivered.sample._id.toString(), sample._id.toString());
  await assert.rejects(
    getVoiceSampleDelivery({ companyId: COMPANY_ID, userId: OTHER_USER_ID, sampleId: sample._id }),
    (error) => error.code === "VOICE_SAMPLE_NOT_FOUND",
  );
  await assert.rejects(
    getVoiceSampleDelivery({ companyId: OTHER_COMPANY_ID, userId: USER_ID, sampleId: sample._id }),
    (error) => error.code === "VOICE_SAMPLE_NOT_FOUND",
  );
  await assert.rejects(
    deleteVoiceSample({
      companyId: COMPANY_ID,
      userId: USER_ID,
      sampleId: sample._id,
      destroyAudio: async () => { throw Object.assign(new Error("storage details"), { code: "VOICE_STORAGE_DELETE_FAILED" }); },
    }),
    (error) => error.code === "VOICE_STORAGE_DELETE_FAILED",
  );
  assert.equal((await DigitalCloneVoiceSample.findById(sample._id)).status, "active");
  let destroyed = false;
  const deleted = await deleteVoiceSample({
    companyId: COMPANY_ID,
    userId: USER_ID,
    sampleId: sample._id,
    destroyAudio: async () => { destroyed = true; },
  });
  assert.equal(destroyed, true);
  assert.equal(deleted.status, "deleted");
});

test("voice creation uses the provider abstraction and is idempotent", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  const first = await createVoiceClone({
    companyId: COMPANY_ID,
    userId: USER_ID,
    provider,
    readSample: async () => wavBuffer(),
  });
  const second = await createVoiceClone({
    companyId: COMPANY_ID,
    userId: USER_ID,
    provider,
    readSample: async () => wavBuffer(),
  });
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(provider.calls.create, 1);
  assert.equal(serializeVoice(first).providerVoiceId, undefined);
});

test("verification-required creation remains private, not ready, and does not trigger duplicate paid creation", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider({ initialStatus: "verification_required" });
  const first = await createVoiceClone({
    companyId: COMPANY_ID,
    userId: USER_ID,
    provider,
    readSample: async () => wavBuffer(),
  });
  const second = await createVoiceClone({
    companyId: COMPANY_ID,
    userId: USER_ID,
    provider,
    readSample: async () => wavBuffer(),
  });
  assert.equal(first.status, "verification_required");
  assert.equal(second.status, "verification_required");
  assert.equal(provider.calls.create, 1);
  assert.equal(serializeVoice(first).providerVoiceId, undefined);
  assert.equal(calculateVoiceReadiness(first).ready, false);
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "blocked" }, provider }),
    (error) => error.code === "VOICE_NOT_READY",
  );
});

test("concurrent create requests acquire one provider creation lock", async () => {
  await authorizeVoice();
  await uploadOneSample();
  let releaseCreation;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const gate = new Promise((resolve) => { releaseCreation = resolve; });
  const provider = new MockVoiceProvider();
  provider.createVoice = async () => {
    provider.calls.create += 1;
    signalStarted();
    await gate;
    return { voiceId: "one-provider-voice", status: "ready" };
  };
  const first = createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  await started;
  await assert.rejects(
    createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() }),
    (error) => error.code === "VOICE_CREATION_IN_PROGRESS",
  );
  releaseCreation();
  assert.equal((await first).status, "ready");
  assert.equal(provider.calls.create, 1);
});

test("sample deletion cannot race an in-flight provider creation", async () => {
  await authorizeVoice();
  const [sample] = await uploadOneSample();
  let releaseCreation;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const gate = new Promise((resolve) => { releaseCreation = resolve; });
  const provider = new MockVoiceProvider();
  provider.createVoice = async () => {
    provider.calls.create += 1;
    signalStarted();
    await gate;
    return { voiceId: "sample-lock-voice", status: "ready" };
  };
  const creation = createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  await started;
  await assert.rejects(
    deleteVoiceSample({ companyId: COMPANY_ID, userId: USER_ID, sampleId: sample._id, destroyAudio: async () => {} }),
    (error) => error.code === "VOICE_CREATION_IN_PROGRESS",
  );
  assert.equal((await DigitalCloneVoiceSample.findById(sample._id)).status, "active");
  releaseCreation();
  assert.equal((await creation).status, "ready");
});

test("revocation during provider creation cannot be overwritten by stale completion", async () => {
  await authorizeVoice();
  await uploadOneSample();
  let releaseCreation;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const gate = new Promise((resolve) => { releaseCreation = resolve; });
  const provider = new MockVoiceProvider();
  provider.createVoice = async () => {
    provider.calls.create += 1;
    signalStarted();
    await gate;
    return { voiceId: "revoked-in-flight-voice", status: "ready" };
  };
  const creation = createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  await started;
  await revokeVoice({ companyId: COMPANY_ID, userId: USER_ID, provider });
  releaseCreation();
  await assert.rejects(creation, (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE");
  const stored = await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID });
  assert.equal(stored.status, "revoked");
  assert.equal(calculateVoiceReadiness(stored).ready, false);
  assert.equal(provider.calls.delete, 1);
});

test("failed cleanup after in-flight revocation retains the private reconciliation reference", async () => {
  await authorizeVoice();
  await uploadOneSample();
  let releaseCreation;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const gate = new Promise((resolve) => { releaseCreation = resolve; });
  const provider = new MockVoiceProvider({ failDelete: true });
  provider.createVoice = async () => {
    provider.calls.create += 1;
    signalStarted();
    await gate;
    return { voiceId: "revoked-orphan-voice", status: "ready" };
  };
  const creation = createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  await started;
  await revokeVoice({ companyId: COMPANY_ID, userId: USER_ID, provider });
  releaseCreation();
  await assert.rejects(creation, (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE");
  const stored = await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })
    .select("+providerVoiceId +providerDeletionStatus +pendingProviderDeletionId");
  assert.equal(stored.status, "revoked");
  assert.equal(stored.providerVoiceId, "");
  assert.equal(stored.providerDeletionStatus, "failed");
  assert.equal(stored.pendingProviderDeletionId, "revoked-orphan-voice");
  assert.equal(calculateVoiceReadiness(stored).ready, false);
});

test("malformed provider creation responses are cleaned up and retryable", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  provider.createVoice = async () => ({ voiceId: "orphan-provider-voice", status: "unexpected" });
  await assert.rejects(
    createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() }),
    (error) => error.code === "VOICE_PROVIDER_INVALID_RESPONSE",
  );
  assert.equal(provider.calls.delete, 1);
  assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).status, "failed");
});

test("provider creation failure is sanitized and leaves retryable state", async () => {
  await authorizeVoice();
  await uploadOneSample();
  await assert.rejects(
    createVoiceClone({
      companyId: COMPANY_ID,
      userId: USER_ID,
      provider: new MockVoiceProvider({ failCreate: true }),
      readSample: async () => wavBuffer(),
    }),
    (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE" && !/simulated/.test(error.message),
  );
  const voice = await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID });
  assert.equal(voice.status, "failed");
});

test("provider timeout is sanitized and leaves a retryable local state", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  provider.createVoice = async () => {
    const error = new Error("connect ECONNABORTED http://internal-voice:9000");
    error.code = "ECONNABORTED";
    throw error;
  };
  await assert.rejects(
    createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() }),
    (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE" && !/internal-voice|ECONNABORTED/.test(error.message),
  );
  assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).status, "failed");
});

test("provider success followed by database finalization failure triggers provider cleanup", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  const originalFindOneAndUpdate = DigitalCloneVoice.findOneAndUpdate;
  let updateCalls = 0;
  DigitalCloneVoice.findOneAndUpdate = function patchedFindOneAndUpdate(...args) {
    updateCalls += 1;
    if (updateCalls === 2) {
      return { select: () => Promise.reject(new Error("database connection details")) };
    }
    return originalFindOneAndUpdate.apply(this, args);
  };
  try {
    await assert.rejects(
      createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() }),
      (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE" && !/database/.test(error.message),
    );
  } finally {
    DigitalCloneVoice.findOneAndUpdate = originalFindOneAndUpdate;
  }
  assert.equal(provider.calls.create, 1);
  assert.equal(provider.calls.delete, 1);
  assert.equal((await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).status, "failed");
});

test("processing voice status is refreshed through the generic provider", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider({ initialStatus: "processing" });
  const voice = await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  assert.equal(voice.status, "processing");
  provider.voices.set(voice.providerVoiceId, "ready");
  const refreshed = await refreshVoiceStatus({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal(refreshed.status, "ready");
});

test("preview delivery, approval, and Step 4 readiness remain human-controlled", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  let storedPreviewId;
  const preview = await generateVoicePreview({
    companyId: COMPANY_ID,
    userId: USER_ID,
    body: { text: "A private test phrase." },
    provider,
    uploadAudio: async ({ buffer }) => {
      assert.ok(buffer.length);
      storedPreviewId = "private-preview";
      return { public_id: storedPreviewId, bytes: buffer.length };
    },
  });
  assert.equal(calculateVoiceReadiness(await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })).ready, false);
  const delivery = await getVoicePreviewDelivery({
    companyId: COMPANY_ID,
    userId: USER_ID,
    previewId: preview._id,
    streamAudio: async ({ storagePublicId }) => {
      assert.equal(storagePublicId, storedPreviewId);
      return Readable.from([wavBuffer()]);
    },
  });
  assert.equal(delivery.preview._id.toString(), preview._id.toString());
  await authorizeVoice({ companyId: COMPANY_ID, userId: OTHER_USER_ID });
  await assert.rejects(
    getVoicePreviewDelivery({ companyId: COMPANY_ID, userId: OTHER_USER_ID, previewId: preview._id }),
    (error) => error.code === "VOICE_PREVIEW_NOT_FOUND",
  );
  const approved = await approveVoice({ companyId: COMPANY_ID, userId: USER_ID, previewId: preview._id });
  assert.equal(calculateVoiceReadiness(approved).ready, true);
  const internal = await getApprovedVoiceForProvider({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.ok(internal.providerVoiceId);
});

test("preview text is bounded and provider failures do not leak", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "x".repeat(1001) }, provider }),
    (error) => error.code === "VOICE_PREVIEW_INVALID",
  );
  provider.failGenerate = true;
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "test" }, provider }),
    (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE" && !/simulated/.test(error.message),
  );
});

test("malformed and oversized provider audio is rejected before private storage", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  let uploads = 0;
  const uploadAudio = async () => { uploads += 1; return { public_id: "must-not-upload" }; };
  provider.generateSpeech = async () => ({ buffer: Buffer.from("not audio") });
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "test" }, provider, uploadAudio }),
    (error) => error.code === "VOICE_PROVIDER_INVALID_RESPONSE",
  );
  provider.generateSpeech = async () => ({ buffer: Buffer.alloc(25 * 1024 * 1024 + 1) });
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "test" }, provider, uploadAudio }),
    (error) => error.code === "VOICE_PROVIDER_INVALID_RESPONSE",
  );
  assert.equal(uploads, 0);
});

test("revocation during preview generation prevents post-provider storage", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  let releaseGeneration;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const gate = new Promise((resolve) => { releaseGeneration = resolve; });
  provider.generateSpeech = async () => {
    signalStarted();
    await gate;
    return { buffer: wavBuffer(), mimeType: "audio/wav" };
  };
  let uploads = 0;
  const generation = generateVoicePreview({
    companyId: COMPANY_ID,
    userId: USER_ID,
    body: { text: "must not persist" },
    provider,
    uploadAudio: async () => { uploads += 1; return { public_id: "must-not-upload" }; },
  });
  await started;
  await revokeVoice({ companyId: COMPANY_ID, userId: USER_ID, provider });
  releaseGeneration();
  await assert.rejects(generation, (error) => error.code === "VOICE_CONSENT_REQUIRED");
  assert.equal(uploads, 0);
});

test("consent invalidation hides sample metadata and blocks sensitive sample operations", async () => {
  await authorizeVoice();
  const [sample] = await uploadOneSample();
  await DigitalCloneVoice.updateOne(
    { companyId: COMPANY_ID, userId: USER_ID },
    { $set: { "consent.revokedAt": new Date() } },
  );
  await assert.rejects(
    listVoiceSamples({ companyId: COMPANY_ID, userId: USER_ID }),
    (error) => error.code === "VOICE_CONSENT_REQUIRED",
  );
  await assert.rejects(
    deleteVoiceSample({ companyId: COMPANY_ID, userId: USER_ID, sampleId: sample._id, destroyAudio: async () => {} }),
    (error) => error.code === "VOICE_CONSENT_REQUIRED",
  );
  const state = await getVoiceState({ companyId: COMPANY_ID, userId: USER_ID, provider: new MockVoiceProvider() });
  assert.deepEqual(state.samples, []);
  assert.deepEqual(state.previews, []);
  assert.equal(state.voice.readiness.ready, false);
});

test("provider-neutral voice settings reject unexpected or invalid values", async () => {
  await authorizeVoice();
  const updated = await updateVoiceSettings({
    companyId: COMPANY_ID,
    userId: USER_ID,
    body: { speakingPace: "slow", expressiveness: 4, language: "en-SG", displayName: "Founder voice" },
  });
  assert.equal(updated.voiceSettings.speakingPace, "slow");
  assert.equal(updated.voiceSettings.expressiveness, 4);
  await assert.rejects(
    updateVoiceSettings({ companyId: COMPANY_ID, userId: USER_ID, body: { exaggeration: 0.9 } }),
    (error) => error.code === "VOICE_SETTINGS_INVALID",
  );
});

test("revocation blocks generation and approved-provider use immediately", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  const preview = await generateVoicePreview({
    companyId: COMPANY_ID,
    userId: USER_ID,
    body: { text: "Approval test" },
    provider,
    uploadAudio: async ({ buffer }) => ({ public_id: "preview-revoke", bytes: buffer.length }),
  });
  await approveVoice({ companyId: COMPANY_ID, userId: USER_ID, previewId: preview._id });
  const revoked = await revokeVoice({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal(revoked.status, "revoked");
  assert.equal(provider.calls.delete, 1);
  assert.equal(calculateVoiceReadiness(revoked).ready, false);
  await assert.rejects(
    generateVoicePreview({ companyId: COMPANY_ID, userId: USER_ID, body: { text: "blocked" }, provider }),
    (error) => error.code === "VOICE_CONSENT_REQUIRED",
  );
  await assert.rejects(
    getApprovedVoiceForProvider({ companyId: COMPANY_ID, userId: USER_ID }),
    (error) => error.code === "VOICE_CONSENT_REQUIRED",
  );
  const storedPreview = await DigitalCloneVoicePreview.findById(preview._id);
  assert.equal(storedPreview.status, "revoked");
});

test("provider deletion failure never re-enables a revoked voice", async () => {
  await authorizeVoice();
  await uploadOneSample();
  const provider = new MockVoiceProvider();
  await createVoiceClone({ companyId: COMPANY_ID, userId: USER_ID, provider, readSample: async () => wavBuffer() });
  provider.failDelete = true;
  const revoked = await revokeVoice({ companyId: COMPANY_ID, userId: USER_ID, provider });
  assert.equal(revoked.status, "revoked");
  const stored = await DigitalCloneVoice.findOne({ companyId: COMPANY_ID, userId: USER_ID })
    .select("+providerDeletionStatus +pendingProviderDeletionId");
  assert.equal(stored.status, "revoked");
  assert.equal(stored.providerDeletionStatus, "failed");
  assert.match(stored.pendingProviderDeletionId, /^mock-/);
});
