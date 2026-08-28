import { createHash } from "node:crypto";
import mongoose from "mongoose";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneVoice from "../models/digitalCloneVoice.js";
import DigitalCloneVoicePreview from "../models/digitalCloneVoicePreview.js";
import DigitalCloneVoiceSample from "../models/digitalCloneVoiceSample.js";
import { DIGITAL_CLONE_VOICE_UPLOAD_LIMITS } from "../middleware/digitalCloneVoiceUpload.js";
import { resolveVoiceProvider } from "../providers/digitalCloneVoice/index.js";
import {
  destroyPrivateVoiceAudio,
  readPrivateVoiceAudio,
  streamPrivateVoiceAudio,
  uploadPrivateVoiceAudio,
} from "./digitalCloneVoiceStorageService.js";

const VOICE_CONSENT_VERSION = "1.0";
const VOICE_PROVIDER_DISPLAY_NAME = "TerraPeak Voice";
const MAX_PROVIDER_TRAINING_BYTES = 75 * 1024 * 1024;
const ALLOWED_SETTINGS_FIELDS = new Set(["speakingPace", "expressiveness", "language", "displayName"]);
const REQUIRED_VOICE_AFFIRMATIONS = [
  "voiceOwnershipOrAuthorization",
  "processingAuthorized",
  "generatedSpeechAuthorized",
  "revocationUnderstood",
];

export const voiceError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const ownedFilter = ({ companyId, userId }) => ({ companyId, userId });

const assertObjectId = (value, code, message) => {
  if (!mongoose.Types.ObjectId.isValid(value)) throw voiceError(message, 404, code);
};

const consentIsCurrent = (voice) => {
  const consent = voice?.consent;
  return Boolean(
    consent?.acceptedAt &&
    !consent?.revokedAt &&
    consent?.version === VOICE_CONSENT_VERSION &&
    REQUIRED_VOICE_AFFIRMATIONS.every((field) => consent[field] === true),
  );
};

export const calculateVoiceReadiness = (voice, { providerAvailable = true, baseConsentValid = true } = {}) => {
  const reasons = [];
  if (!baseConsentValid) reasons.push("base_digital_clone_consent_required");
  if (!consentIsCurrent(voice)) reasons.push("voice_consent_required");
  if (!providerAvailable) reasons.push("voice_provider_not_configured");
  if (voice?.status !== "ready") reasons.push("provider_voice_not_ready");
  if (!voice?.approvedAt) reasons.push("human_approval_required");
  if (voice?.status === "revoked" || voice?.revokedAt) reasons.push("voice_revoked");
  return { ready: reasons.length === 0, reasons };
};

export const serializeVoice = (voice, { providerAvailable = true, baseConsentValid = true } = {}) => {
  if (!voice) {
    return {
      providerDisplayName: VOICE_PROVIDER_DISPLAY_NAME,
      status: "not_started",
      language: "en",
      displayName: "My Voice",
      voiceSettings: { speakingPace: "moderate", expressiveness: 3 },
      consent: null,
      approvedAt: null,
      revokedAt: null,
      readiness: calculateVoiceReadiness(null, { providerAvailable, baseConsentValid }),
    };
  }
  const value = typeof voice.toObject === "function" ? voice.toObject() : { ...voice };
  return {
    id: String(value._id),
    providerDisplayName: VOICE_PROVIDER_DISPLAY_NAME,
    status: value.status,
    language: value.language,
    displayName: value.displayName,
    voiceSettings: value.voiceSettings,
    consent: value.consent ? {
      voiceOwnershipOrAuthorization: value.consent.voiceOwnershipOrAuthorization,
      processingAuthorized: value.consent.processingAuthorized,
      generatedSpeechAuthorized: value.consent.generatedSpeechAuthorized,
      revocationUnderstood: value.consent.revocationUnderstood,
      version: value.consent.version,
      acceptedAt: value.consent.acceptedAt,
      revokedAt: value.consent.revokedAt,
    } : null,
    approvedAt: value.approvedAt,
    revokedAt: value.revokedAt,
    readiness: calculateVoiceReadiness(value, { providerAvailable, baseConsentValid }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

export const serializeVoiceSample = (sample) => {
  const value = typeof sample.toObject === "function" ? sample.toObject() : { ...sample };
  return {
    id: String(value._id),
    filename: value.filename,
    mimeType: value.mimeType,
    bytes: value.bytes,
    durationSeconds: value.durationSeconds,
    status: value.status,
    createdAt: value.createdAt,
  };
};

export const serializeVoicePreview = (preview) => {
  const value = typeof preview.toObject === "function" ? preview.toObject() : { ...preview };
  return {
    id: String(value._id),
    text: value.text,
    mimeType: value.mimeType,
    bytes: value.bytes,
    status: value.status,
    approvedAt: value.approvedAt,
    createdAt: value.createdAt,
  };
};

export const assertBaseDigitalCloneVoiceRights = async ({ companyId, userId }) => {
  const profile = await DigitalCloneProfile.findOne(ownedFilter({ companyId, userId })).select("status consent").lean();
  const consent = profile?.consent;
  if (
    !["consented", "setup"].includes(profile?.status) ||
    !consent?.acceptedAt ||
    !consent?.identityConfirmed ||
    !consent?.voiceRightsConfirmed ||
    !consent?.aiRepresentationConsent
  ) {
    throw voiceError(
      "Complete Digital Clone identity, voice-rights, and AI-representation consent first.",
      409,
      "DIGITAL_CLONE_BASE_VOICE_CONSENT_REQUIRED",
    );
  }
  return profile;
};

export const assertVoiceConsent = async ({ companyId, userId }) => {
  await assertBaseDigitalCloneVoiceRights({ companyId, userId });
  const voice = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId }));
  if (!voice || !consentIsCurrent(voice)) {
    throw voiceError(
      "Explicit Voice Clone authorization is required before this action.",
      409,
      "VOICE_CONSENT_REQUIRED",
    );
  }
  return voice;
};

export const acceptVoiceConsent = async ({ companyId, userId, body, acceptedIp }) => {
  await assertBaseDigitalCloneVoiceRights({ companyId, userId });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw voiceError("Voice authorization must be an object.", 400, "VOICE_CONSENT_INVALID");
  }
  const unexpected = Object.keys(body).filter((field) => !REQUIRED_VOICE_AFFIRMATIONS.includes(field));
  const missing = REQUIRED_VOICE_AFFIRMATIONS.filter((field) => body[field] !== true);
  if (unexpected.length || missing.length) {
    throw voiceError(
      "All Voice Clone authorization affirmations are required.",
      400,
      "VOICE_CONSENT_REQUIRED",
    );
  }
  const activeSamples = await DigitalCloneVoiceSample.countDocuments({ companyId, userId, status: "active" });
  const existing = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId }))
    .select("+providerDeletionStatus +pendingProviderDeletionId");
  const reactivating = Boolean(existing?.status === "revoked" || existing?.consent?.revokedAt);
  const update = {
    $set: {
      consent: {
        ...Object.fromEntries(REQUIRED_VOICE_AFFIRMATIONS.map((field) => [field, true])),
        version: VOICE_CONSENT_VERSION,
        acceptedAt: new Date(),
        acceptedIp: String(acceptedIp || "").slice(0, 200),
        revokedAt: null,
      },
      activeSampleCount: activeSamples,
    },
    $setOnInsert: { companyId, userId },
  };
  if (!existing || reactivating) {
    Object.assign(update.$set, {
      status: activeSamples ? "samples_uploaded" : "not_started",
      approvedAt: null,
      approvedPreviewId: null,
      revokedAt: null,
    });
    if (existing?.providerDeletionStatus !== "failed") {
      update.$set.providerDeletionStatus = "not_requested";
      update.$set.pendingProviderDeletionId = "";
    }
  }
  if (reactivating) update.$unset = { providerVoiceId: "", provider: "" };
  const voice = await DigitalCloneVoice.findOneAndUpdate(
    ownedFilter({ companyId, userId }),
    update,
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return voice;
};

const detectAudio = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return { mimeType: "audio/wav", extension: ".wav" };
  }
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { mimeType: "audio/mpeg", extension: ".mp3" };
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return { mimeType: "audio/mp4", extension: ".m4a" };
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mimeType: "audio/webm", extension: ".webm" };
  }
  return null;
};

const estimateWavDuration = (buffer) => {
  if (buffer.length < 44) return null;
  const byteRate = buffer.readUInt32LE(28);
  const dataBytes = buffer.readUInt32LE(40);
  if (!byteRate || !dataBytes) return null;
  return Math.round((dataBytes / byteRate) * 10) / 10;
};

export const validateAudioSample = ({ buffer, filename, declaredMimeType, durationHint }) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw voiceError("The voice recording is empty.", 400, "VOICE_SAMPLE_INVALID");
  }
  if (buffer.length > DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFileBytes) {
    throw voiceError("Each voice recording must be no larger than 25 MB.", 400, "VOICE_SAMPLE_TOO_LARGE");
  }
  const detected = detectAudio(buffer);
  if (!detected) {
    throw voiceError("The uploaded file is not a supported audio recording.", 400, "VOICE_SAMPLE_INVALID");
  }
  const declared = String(declaredMimeType || "").toLowerCase();
  const compatible =
    (detected.mimeType === "audio/wav" && ["audio/wav", "audio/x-wav"].includes(declared)) ||
    (detected.mimeType === "audio/mpeg" && declared === "audio/mpeg") ||
    (detected.mimeType === "audio/mp4" && ["audio/mp4", "audio/x-m4a"].includes(declared)) ||
    (detected.mimeType === "audio/webm" && declared === "audio/webm");
  if (!compatible) {
    throw voiceError("The recording content does not match its declared audio type.", 400, "VOICE_SAMPLE_TYPE_MISMATCH");
  }
  const base = String(filename || "recording")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "recording";
  const parsedHint = Number(durationHint);
  const durationSeconds = detected.mimeType === "audio/wav"
    ? estimateWavDuration(buffer)
    : Number.isFinite(parsedHint) && parsedHint > 0 && parsedHint <= 600
      ? Math.round(parsedHint * 10) / 10
      : null;
  return { ...detected, filename: `${base}${detected.extension}`, durationSeconds };
};

export const uploadVoiceSamples = async ({
  companyId,
  userId,
  files,
  durationHints = [],
  uploadAudio = uploadPrivateVoiceAudio,
  destroyAudio = destroyPrivateVoiceAudio,
}) => {
  await assertVoiceConsent({ companyId, userId });
  if (!files?.length) throw voiceError("Select at least one voice recording.", 400, "VOICE_SAMPLES_REQUIRED");
  if (files.length > DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFilesPerRequest) {
    throw voiceError("Upload at most three recordings at once.", 400, "VOICE_SAMPLE_REQUEST_LIMIT");
  }
  const validatedFiles = files.map((file, index) => validateAudioSample({
    buffer: file.buffer,
    filename: file.originalname,
    declaredMimeType: file.mimetype,
    durationHint: durationHints[index],
  }));
  const reserved = await DigitalCloneVoice.findOneAndUpdate(
    {
      companyId,
      userId,
      status: { $ne: "revoked" },
      "consent.revokedAt": null,
      activeSampleCount: { $lte: DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxActiveSamples - files.length },
    },
    { $inc: { activeSampleCount: files.length } },
    { new: true, runValidators: true },
  );
  if (!reserved) {
    throw voiceError("A voice can have at most 10 active recordings.", 409, "VOICE_SAMPLE_ACTIVE_LIMIT");
  }
  const created = [];
  const uploadedRecords = [];
  try {
    for (const [index, file] of files.entries()) {
      const validated = validatedFiles[index];
      const upload = await uploadAudio({
        buffer: file.buffer,
        companyId,
        userId,
        kind: "samples",
        filename: validated.filename,
      });
      uploadedRecords.push({
        publicId: upload.public_id,
        index,
        bytes: upload.bytes || file.buffer.length,
      });
      created.push(await DigitalCloneVoiceSample.create({
        companyId,
        userId,
        filename: validated.filename,
        mimeType: validated.mimeType,
        storagePublicId: upload.public_id,
        bytes: upload.bytes || file.buffer.length,
        durationSeconds: validated.durationSeconds,
      }));
    }
    await assertVoiceConsent({ companyId, userId });
    await DigitalCloneVoice.updateOne(
      { companyId, userId, status: { $in: ["not_started", "failed"] }, "consent.revokedAt": null },
      { $set: { status: "samples_uploaded", approvedAt: null, approvedPreviewId: null } },
    );
    return created;
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      uploadedRecords.map(({ publicId }) => destroyAudio(publicId)),
    );
    const failedCleanupIds = new Set(
      uploadedRecords
        .filter((_record, index) => cleanupResults[index]?.status === "rejected")
        .map(({ publicId }) => publicId),
    );
    const cleanedCreatedIds = created
      .filter((sample) => !failedCleanupIds.has(sample.storagePublicId))
      .map((sample) => sample._id);
    if (cleanedCreatedIds.length) {
      await DigitalCloneVoiceSample.deleteMany({ _id: { $in: cleanedCreatedIds }, companyId, userId });
    }
    for (const record of uploadedRecords.filter(({ publicId }) => failedCleanupIds.has(publicId))) {
      const existing = created.find((sample) => sample.storagePublicId === record.publicId);
      if (existing) {
        await DigitalCloneVoiceSample.updateOne(
          { _id: existing._id, companyId, userId },
          { $set: { status: "deleting" } },
        );
      } else {
        const validated = validatedFiles[record.index];
        await DigitalCloneVoiceSample.create({
          companyId,
          userId,
          filename: validated.filename,
          mimeType: validated.mimeType,
          storagePublicId: record.publicId,
          bytes: record.bytes,
          durationSeconds: validated.durationSeconds,
          status: "deleting",
        });
      }
    }
    await DigitalCloneVoice.updateOne(
      { companyId, userId },
      { $inc: { activeSampleCount: -files.length } },
    );
    throw error;
  }
};

export const listVoiceSamples = async ({ companyId, userId }) => {
  await assertVoiceConsent({ companyId, userId });
  return DigitalCloneVoiceSample.find({ companyId, userId }).sort({ createdAt: -1 });
};

const findOwnedSample = async ({ companyId, userId, sampleId, includeDeleted = false }) => {
  assertObjectId(sampleId, "VOICE_SAMPLE_NOT_FOUND", "Voice recording not found.");
  const sample = await DigitalCloneVoiceSample.findOne({
    _id: sampleId,
    companyId,
    userId,
    ...(includeDeleted ? {} : { status: "active" }),
  }).select("+storagePublicId");
  if (!sample) throw voiceError("Voice recording not found.", 404, "VOICE_SAMPLE_NOT_FOUND");
  return sample;
};

export const getVoiceSampleDelivery = async ({ companyId, userId, sampleId, streamAudio = streamPrivateVoiceAudio }) => {
  await assertVoiceConsent({ companyId, userId });
  const sample = await findOwnedSample({ companyId, userId, sampleId });
  return { sample, stream: await streamAudio({ storagePublicId: sample.storagePublicId }) };
};

export const deleteVoiceSample = async ({ companyId, userId, sampleId, destroyAudio = destroyPrivateVoiceAudio }) => {
  await assertVoiceConsent({ companyId, userId });
  assertObjectId(sampleId, "VOICE_SAMPLE_NOT_FOUND", "Voice recording not found.");
  const sample = await DigitalCloneVoiceSample.findOneAndUpdate(
    { _id: sampleId, companyId, userId, status: { $in: ["active", "deleting"] } },
    { $set: { status: "deleting" } },
    { new: true, runValidators: true },
  ).select("+storagePublicId");
  if (!sample) throw voiceError("Voice recording not found.", 404, "VOICE_SAMPLE_NOT_FOUND");
  const creationInProgress = await DigitalCloneVoice.exists({ companyId, userId, status: "processing" });
  if (creationInProgress) {
    await DigitalCloneVoiceSample.updateOne(
      { _id: sample._id, companyId, userId, status: "deleting" },
      { $set: { status: "active" } },
    );
    throw voiceError("Voice creation is already in progress.", 409, "VOICE_CREATION_IN_PROGRESS");
  }
  try {
    await destroyAudio(sample.storagePublicId);
  } catch (error) {
    await DigitalCloneVoiceSample.updateOne(
      { _id: sample._id, companyId, userId, status: "deleting" },
      { $set: { status: "active" } },
    );
    throw error;
  }
  const deleted = await DigitalCloneVoiceSample.findOneAndUpdate(
    { _id: sample._id, companyId, userId, status: "deleting" },
    { $set: { status: "deleted", deletedAt: new Date() } },
    { new: true, runValidators: true },
  );
  if (!deleted) throw voiceError("Voice recording deletion could not be finalized.", 500, "VOICE_SAMPLE_DELETE_FAILED");
  await DigitalCloneVoice.updateOne(
    { companyId, userId, activeSampleCount: { $gt: 0 } },
    { $inc: { activeSampleCount: -1 } },
  );
  return deleted;
};

export const normalizeVoiceSettings = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw voiceError("Voice settings must be an object.", 400, "VOICE_SETTINGS_INVALID");
  }
  if (Object.keys(body).some((field) => !ALLOWED_SETTINGS_FIELDS.has(field))) {
    throw voiceError("Voice settings contain unexpected fields.", 400, "VOICE_SETTINGS_INVALID");
  }
  const update = {};
  if (body.speakingPace !== undefined) {
    if (!new Set(["slow", "moderate", "fast"]).has(body.speakingPace)) {
      throw voiceError("Speaking pace is invalid.", 400, "VOICE_SETTINGS_INVALID");
    }
    update["voiceSettings.speakingPace"] = body.speakingPace;
  }
  if (body.expressiveness !== undefined) {
    if (!Number.isInteger(body.expressiveness) || body.expressiveness < 1 || body.expressiveness > 5) {
      throw voiceError("Expressiveness must be an integer from 1 to 5.", 400, "VOICE_SETTINGS_INVALID");
    }
    update["voiceSettings.expressiveness"] = body.expressiveness;
  }
  if (body.language !== undefined) {
    const language = String(body.language).trim();
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
      throw voiceError("Language must use a standard language code.", 400, "VOICE_SETTINGS_INVALID");
    }
    update.language = language;
  }
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.trim().length > 120) {
      throw voiceError("Voice display name must contain 1 to 120 characters.", 400, "VOICE_SETTINGS_INVALID");
    }
    update.displayName = body.displayName.trim();
  }
  return update;
};

export const updateVoiceSettings = async ({ companyId, userId, body }) => {
  await assertVoiceConsent({ companyId, userId });
  const update = normalizeVoiceSettings(body);
  return DigitalCloneVoice.findOneAndUpdate(
    ownedFilter({ companyId, userId }),
    { $set: update },
    { new: true, runValidators: true },
  );
};

const providerNotConfigured = () => voiceError(
  "TerraPeak Voice is not available yet.",
  503,
  "VOICE_PROVIDER_NOT_CONFIGURED",
);

const PROVIDER_ERROR_RESPONSES = Object.freeze({
  VOICE_PROVIDER_AUTH_FAILED: ["TerraPeak Voice authentication failed.", 502],
  VOICE_PROVIDER_QUOTA_EXCEEDED: ["TerraPeak Voice usage capacity has been reached.", 502],
  VOICE_PROVIDER_RATE_LIMITED: ["TerraPeak Voice is receiving too many requests.", 429],
  VOICE_SAMPLE_REJECTED: ["One or more voice recordings could not be accepted.", 400],
  VOICE_SAMPLE_PROVIDER_LIMIT: ["Active voice recordings exceed the provider training limit.", 400],
  VOICE_VERIFICATION_REQUIRED: ["Additional voice verification is required before this voice can be used.", 409],
  VOICE_NOT_FOUND: ["The TerraPeak Voice resource could not be found.", 404],
  VOICE_PROVIDER_TIMEOUT: ["TerraPeak Voice timed out.", 504],
  VOICE_PROVIDER_INVALID_RESPONSE: ["TerraPeak Voice returned an invalid response.", 502],
  VOICE_PROVIDER_UNAVAILABLE: ["TerraPeak Voice could not complete the request.", 502],
});

const sanitizedProviderError = (error) => {
  if (error?.code === "VOICE_PROVIDER_NOT_CONFIGURED") return providerNotConfigured();
  const [message, statusCode] = PROVIDER_ERROR_RESPONSES[error?.code] || PROVIDER_ERROR_RESPONSES.VOICE_PROVIDER_UNAVAILABLE;
  return voiceError(message, statusCode, PROVIDER_ERROR_RESPONSES[error?.code] ? error.code : "VOICE_PROVIDER_UNAVAILABLE");
};

const assertProviderConfigured = (provider) => {
  provider?.assertConfigured?.();
  return provider;
};

const providerAvailability = (providerName, injectedProvider) => {
  try {
    assertProviderConfigured(injectedProvider || resolveVoiceProvider(providerName));
    return { available: true };
  } catch (error) {
    if (error?.code === "VOICE_PROVIDER_NOT_CONFIGURED") {
      return { available: false, code: "VOICE_PROVIDER_NOT_CONFIGURED" };
    }
    throw error;
  }
};

export const createVoiceClone = async ({
  companyId,
  userId,
  provider: injectedProvider,
  readSample = readPrivateVoiceAudio,
}) => {
  await assertVoiceConsent({ companyId, userId });
  const current = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId })).select("+providerVoiceId +provider");
  if (["ready", "verification_required"].includes(current?.status) && current.providerVoiceId) return current;
  if (current?.status === "processing") {
    throw voiceError("Voice creation is already in progress.", 409, "VOICE_CREATION_IN_PROGRESS");
  }
  const activeSampleCount = await DigitalCloneVoiceSample.countDocuments({ companyId, userId, status: "active" });
  if (!activeSampleCount) throw voiceError("Upload at least one valid voice recording first.", 409, "VOICE_SAMPLES_REQUIRED");

  const startedAt = new Date();
  const locked = await DigitalCloneVoice.findOneAndUpdate(
    {
      companyId,
      userId,
      status: { $nin: ["processing", "verification_required", "ready"] },
      "consent.acceptedAt": { $ne: null },
      "consent.revokedAt": null,
    },
    {
      $set: {
        status: "processing",
        creationStartedAt: startedAt,
        approvedAt: null,
        approvedPreviewId: null,
      },
    },
    { new: true, runValidators: true },
  ).select("+providerVoiceId +provider");
  if (!locked) {
    const latest = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId })).select("+providerVoiceId +provider");
    if (["ready", "verification_required"].includes(latest?.status) && latest.providerVoiceId) return latest;
    throw voiceError("Voice creation is already in progress.", 409, "VOICE_CREATION_IN_PROGRESS");
  }

  const samples = await DigitalCloneVoiceSample.find({ companyId, userId, status: "active" })
    .select("+storagePublicId")
    .sort({ createdAt: 1 });
  const totalSampleBytes = samples.reduce((total, sample) => total + Number(sample.bytes || 0), 0);
  if (!samples.length || totalSampleBytes > MAX_PROVIDER_TRAINING_BYTES) {
    await DigitalCloneVoice.updateOne(
      { _id: locked._id, companyId, userId, status: "processing", creationStartedAt: startedAt },
      { $set: { status: "samples_uploaded", creationStartedAt: null } },
    );
    if (!samples.length) {
      throw voiceError("Upload at least one valid voice recording first.", 409, "VOICE_SAMPLES_REQUIRED");
    }
    throw voiceError("Active voice recordings exceed the provider training limit.", 400, "VOICE_SAMPLE_PROVIDER_LIMIT");
  }
  await DigitalCloneVoice.updateOne(
    { _id: locked._id, companyId, userId, status: "processing", creationStartedAt: startedAt },
    { $set: { trainingSampleIds: samples.map((sample) => sample._id) } },
  );

  let provider;
  let createdProviderVoiceId = "";
  try {
    provider = assertProviderConfigured(injectedProvider || resolveVoiceProvider());
    const providerSamples = [];
    let providerSampleBytes = 0;
    for (const sample of samples) {
      const buffer = await readSample({ storagePublicId: sample.storagePublicId });
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFileBytes) {
        throw voiceError("A stored voice recording is invalid.", 400, "VOICE_SAMPLE_REJECTED");
      }
      providerSampleBytes += buffer.length;
      if (providerSampleBytes > MAX_PROVIDER_TRAINING_BYTES) {
        throw voiceError("Active voice recordings exceed the provider training limit.", 400, "VOICE_SAMPLE_PROVIDER_LIMIT");
      }
      providerSamples.push({
        filename: sample.filename,
        mimeType: sample.mimeType,
        buffer,
      });
    }
    const result = await provider.createVoice({
      samples: providerSamples,
      name: `TerraPeak Voice ${createHash("sha256").update(`${companyId}:${userId}`).digest("hex").slice(0, 16)}`,
      language: locked.language,
      settings: locked.voiceSettings,
    });
    createdProviderVoiceId = String(result?.voiceId || "").trim();
    if (!createdProviderVoiceId || !["processing", "verification_required", "ready"].includes(result.status)) {
      throw voiceError("TerraPeak Voice returned an invalid response.", 502, "VOICE_PROVIDER_INVALID_RESPONSE");
    }
    await assertVoiceConsent({ companyId, userId });
    const finalized = await DigitalCloneVoice.findOneAndUpdate(
      {
        _id: locked._id,
        companyId,
        userId,
        status: "processing",
        creationStartedAt: startedAt,
        "consent.revokedAt": null,
      },
      {
        $set: {
          provider: provider.name,
          providerVoiceId: createdProviderVoiceId,
          status: result.status,
        },
      },
      { new: true, runValidators: true },
    ).select("+providerVoiceId +provider");
    if (!finalized) throw voiceError("Voice creation authorization changed.", 409, "VOICE_CREATION_CANCELLED");
    return finalized;
  } catch (error) {
    let cleanupFailed = false;
    if (createdProviderVoiceId) {
      try {
        await provider.deleteVoice({ voiceId: createdProviderVoiceId });
      } catch {
        cleanupFailed = true;
      }
    }
    await DigitalCloneVoice.updateOne(
      { companyId, userId, status: "processing", creationStartedAt: startedAt },
      {
        $set: {
          status: error?.code === "VOICE_PROVIDER_NOT_CONFIGURED" || error?.code?.startsWith?.("VOICE_SAMPLE_")
            ? "samples_uploaded"
            : "failed",
        },
      },
    );
    if (cleanupFailed) {
      await DigitalCloneVoice.updateOne(
        { _id: locked._id, companyId, userId, creationStartedAt: startedAt },
        {
          $set: {
            providerDeletionStatus: "failed",
            pendingProviderDeletionId: createdProviderVoiceId,
          },
        },
      );
    }
    throw sanitizedProviderError(error);
  }
};

export const refreshVoiceStatus = async ({ companyId, userId, provider: injectedProvider }) => {
  const voice = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId })).select("+providerVoiceId +provider");
  if (!voice || voice.status !== "processing" || !voice.providerVoiceId) return voice;
  const provider = injectedProvider || resolveVoiceProvider(voice.provider);
  try {
    assertProviderConfigured(provider);
    const result = await provider.getStatus({ voiceId: voice.providerVoiceId });
    if (["ready", "failed"].includes(result.status)) {
      const updated = await DigitalCloneVoice.findOneAndUpdate(
        { _id: voice._id, companyId, userId, status: "processing", revokedAt: null, "consent.revokedAt": null },
        { $set: { status: result.status } },
        { new: true, runValidators: true },
      ).select("+providerVoiceId +provider");
      return updated || DigitalCloneVoice.findOne(ownedFilter({ companyId, userId })).select("+providerVoiceId +provider");
    }
    return voice;
  } catch (error) {
    throw sanitizedProviderError(error);
  }
};

const normalizePreviewText = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((field) => field !== "text")) {
    throw voiceError("Preview input must contain only text.", 400, "VOICE_PREVIEW_INVALID");
  }
  if (typeof body.text !== "string") throw voiceError("Preview text is required.", 400, "VOICE_PREVIEW_INVALID");
  const text = body.text.trim();
  if (!text || text.length > 1000) {
    throw voiceError("Preview text must contain 1 to 1000 characters.", 400, "VOICE_PREVIEW_INVALID");
  }
  return text;
};

export const generateVoicePreview = async ({
  companyId,
  userId,
  body,
  provider: injectedProvider,
  uploadAudio = uploadPrivateVoiceAudio,
  destroyAudio = destroyPrivateVoiceAudio,
}) => {
  await assertVoiceConsent({ companyId, userId });
  const text = normalizePreviewText(body);
  const voice = await DigitalCloneVoice.findOne({ companyId, userId, status: "ready", revokedAt: null })
    .select("+providerVoiceId +provider");
  if (!voice?.providerVoiceId) throw voiceError("Create a ready voice before generating a preview.", 409, "VOICE_NOT_READY");
  let provider;
  let generated;
  try {
    provider = assertProviderConfigured(injectedProvider || resolveVoiceProvider(voice.provider));
    generated = await provider.generateSpeech({
      voiceId: voice.providerVoiceId,
      text,
      language: voice.language,
      settings: voice.voiceSettings,
    });
  } catch (error) {
    throw sanitizedProviderError(error);
  }
  await assertVoiceConsent({ companyId, userId });
  const currentVoice = await DigitalCloneVoice.exists({
    _id: voice._id,
    companyId,
    userId,
    status: "ready",
    revokedAt: null,
    "consent.revokedAt": null,
  });
  if (!currentVoice) throw voiceError("Voice authorization changed during preview generation.", 409, "VOICE_CONSENT_REQUIRED");
  if (!Buffer.isBuffer(generated?.buffer) || generated.buffer.length > DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFileBytes) {
    throw voiceError("TerraPeak Voice returned invalid audio.", 502, "VOICE_PROVIDER_INVALID_RESPONSE");
  }
  const detected = detectAudio(generated.buffer);
  if (!detected) throw voiceError("TerraPeak Voice returned invalid audio.", 502, "VOICE_PROVIDER_INVALID_RESPONSE");
  const upload = await uploadAudio({
    buffer: generated.buffer,
    companyId,
    userId,
    kind: "previews",
    filename: `voice-preview-${Date.now()}${detected.extension}`,
  });
  try {
    return await DigitalCloneVoicePreview.create({
      companyId,
      userId,
      voiceId: voice._id,
      text,
      mimeType: detected.mimeType,
      storagePublicId: upload.public_id,
      bytes: upload.bytes || generated.buffer.length,
    });
  } catch (error) {
    await Promise.resolve(destroyAudio(upload.public_id)).catch(() => {});
    throw error;
  }
};

const findOwnedPreview = async ({ companyId, userId, previewId }) => {
  assertObjectId(previewId, "VOICE_PREVIEW_NOT_FOUND", "Voice preview not found.");
  const preview = await DigitalCloneVoicePreview.findOne({
    _id: previewId,
    companyId,
    userId,
    status: "active",
  }).select("+storagePublicId");
  if (!preview) throw voiceError("Voice preview not found.", 404, "VOICE_PREVIEW_NOT_FOUND");
  return preview;
};

export const getVoicePreviewDelivery = async ({ companyId, userId, previewId, streamAudio = streamPrivateVoiceAudio }) => {
  await assertVoiceConsent({ companyId, userId });
  const voice = await DigitalCloneVoice.findOne({ companyId, userId, status: "ready", revokedAt: null }).lean();
  if (!voice) throw voiceError("Voice preview not found.", 404, "VOICE_PREVIEW_NOT_FOUND");
  const preview = await findOwnedPreview({ companyId, userId, previewId });
  if (String(preview.voiceId) !== String(voice._id)) throw voiceError("Voice preview not found.", 404, "VOICE_PREVIEW_NOT_FOUND");
  return { preview, stream: await streamAudio({ storagePublicId: preview.storagePublicId }) };
};

export const approveVoice = async ({ companyId, userId, previewId }) => {
  await assertVoiceConsent({ companyId, userId });
  const preview = await findOwnedPreview({ companyId, userId, previewId });
  const approvedAt = new Date();
  const voice = await DigitalCloneVoice.findOneAndUpdate(
    { _id: preview.voiceId, companyId, userId, status: "ready", revokedAt: null },
    { $set: { approvedAt, approvedPreviewId: preview._id } },
    { new: true, runValidators: true },
  );
  if (!voice) throw voiceError("A ready voice is required before approval.", 409, "VOICE_NOT_READY");
  preview.approvedAt = approvedAt;
  await preview.save();
  return voice;
};

export const revokeVoice = async ({ companyId, userId, provider: injectedProvider }) => {
  const voice = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId }))
    .select("+providerVoiceId +provider +providerDeletionStatus +pendingProviderDeletionId");
  if (!voice) throw voiceError("Voice not found.", 404, "VOICE_NOT_FOUND");
  if (voice.status === "revoked") return voice;
  const providerVoiceId = voice.providerVoiceId;
  const providerName = voice.provider;
  const revokedAt = new Date();
  voice.status = "revoked";
  voice.revokedAt = revokedAt;
  voice.approvedAt = null;
  voice.approvedPreviewId = null;
  voice.consent.revokedAt = revokedAt;
  voice.providerDeletionStatus = providerVoiceId ? "pending" : "not_requested";
  voice.pendingProviderDeletionId = providerVoiceId || "";
  await voice.save();
  await DigitalCloneVoicePreview.updateMany(
    { companyId, userId, status: "active" },
    { $set: { status: "revoked", revokedAt } },
  );
  if (providerVoiceId) {
    try {
      const provider = injectedProvider || resolveVoiceProvider(providerName);
      await provider.deleteVoice({ voiceId: providerVoiceId });
      voice.providerDeletionStatus = "deleted";
      voice.providerVoiceId = "";
      voice.pendingProviderDeletionId = "";
    } catch {
      voice.providerDeletionStatus = "failed";
    }
    await voice.save();
  }
  return voice;
};

export const getVoiceState = async ({ companyId, userId, provider }) => {
  let voice;
  try {
    voice = await refreshVoiceStatus({ companyId, userId, provider });
  } catch (error) {
    if (!["VOICE_PROVIDER_UNAVAILABLE", "VOICE_PROVIDER_NOT_CONFIGURED"].includes(error?.code)) throw error;
    voice = await DigitalCloneVoice.findOne(ownedFilter({ companyId, userId })).select("+provider");
  }
  const availability = providerAvailability(voice?.provider || undefined, provider);
  let baseConsentValid = false;
  let sensitiveMediaAuthorized = false;
  try {
    await assertBaseDigitalCloneVoiceRights({ companyId, userId });
    baseConsentValid = true;
    sensitiveMediaAuthorized = consentIsCurrent(voice);
  } catch (error) {
    if (error?.code !== "DIGITAL_CLONE_BASE_VOICE_CONSENT_REQUIRED") throw error;
  }
  const [samples, previews] = sensitiveMediaAuthorized
    ? await Promise.all([
      listVoiceSamples({ companyId, userId }),
      DigitalCloneVoicePreview.find({ companyId, userId }).sort({ createdAt: -1 }).limit(20),
    ])
    : [[], []];
  return {
    voice: serializeVoice(voice, {
      providerAvailable: availability.available,
      baseConsentValid,
    }),
    samples: samples.map(serializeVoiceSample),
    previews: previews.map(serializeVoicePreview),
    providerAvailability: availability,
    limits: DIGITAL_CLONE_VOICE_UPLOAD_LIMITS,
  };
};

export const getApprovedVoiceForProvider = async ({ companyId, userId, provider: injectedProvider }) => {
  await assertVoiceConsent({ companyId, userId });
  const voice = await DigitalCloneVoice.findOne({
    companyId,
    userId,
    status: "ready",
    approvedAt: { $ne: null },
    revokedAt: null,
  }).select("+providerVoiceId +provider").lean();
  if (!voice?.providerVoiceId) throw voiceError("An approved voice is required.", 409, "VOICE_NOT_APPROVED");
  try {
    assertProviderConfigured(injectedProvider || resolveVoiceProvider(voice.provider));
  } catch (error) {
    if (error?.code === "VOICE_PROVIDER_NOT_CONFIGURED") throw providerNotConfigured();
    throw error;
  }
  return voice;
};

export const DIGITAL_CLONE_VOICE_CONSTANTS = Object.freeze({
  consentVersion: VOICE_CONSENT_VERSION,
  providerDisplayName: VOICE_PROVIDER_DISPLAY_NAME,
  maxPreviewCharacters: 1000,
});
