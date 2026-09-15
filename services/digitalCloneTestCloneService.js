import { createHash } from "node:crypto";
import mongoose from "mongoose";
import DigitalCloneAvatar from "../models/digitalCloneAvatar.js";
import DigitalCloneAvatarCandidate from "../models/digitalCloneAvatarCandidate.js";
import DigitalCloneAvatarProviderVoice from "../models/digitalCloneAvatarProviderVoice.js";
import DigitalCloneAvatarVideo from "../models/digitalCloneAvatarVideo.js";
import DigitalCloneBrainProfile from "../models/digitalCloneBrainProfile.js";
import DigitalCloneGeneration from "../models/digitalCloneGeneration.js";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneTestClone from "../models/digitalCloneTestClone.js";
import {
  AVATAR_CONSTANTS,
  createAvatarVideo,
  getAvatarState,
  getAvatarVideoDelivery,
  refreshAvatarVideo,
  rejectAvatarVideo,
} from "./digitalCloneAvatarService.js";
import { calculateDigitalBrainReadiness } from "./digitalCloneBrainService.js";
import { generateDigitalCloneText } from "./digitalCloneGenerationService.js";

const MAX_PROMPT_CHARACTERS = 1000;
const SOURCE_FIELDS = new Set(["prompt"]);
const DRAFT_FIELDS = new Set(["draftId"]);
const SCRIPT_FIELDS = new Set(["script"]);
const GENERATION_FIELDS = new Set(["aspectRatio", "resolution", "captions", "background"]);
const ACTIVE_VIDEO_STATUSES = new Set(["queued", "processing"]);
const TERMINAL_VIDEO_STATUSES = new Set(["completed", "failed", "approved", "rejected", "archived"]);
const hashText = (value) => createHash("sha256").update(value).digest("hex");
const owned = ({ companyId, userId }) => ({ companyId, userId });

export const testCloneError = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const strictObject = (body, allowed) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((field) => !allowed.has(field))) {
    throw testCloneError("TEST_CLONE_INVALID_REQUEST", "The Test Clone request contains invalid fields.");
  }
};

const validId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw testCloneError("TEST_CLONE_NOT_FOUND", "Test Clone item not found.", 404);
  return id;
};

const getOwnedTestClone = async ({ companyId, userId, testCloneId }) => {
  const record = await DigitalCloneTestClone.findOne({ _id: validId(testCloneId), companyId, userId });
  if (!record) throw testCloneError("TEST_CLONE_NOT_FOUND", "Test Clone item not found.", 404);
  return record;
};

const baseConsentValid = (profile) => Boolean(
  ["consented", "setup"].includes(profile?.status)
  && profile?.consent?.acceptedAt
  && profile.consent.identityConfirmed
  && profile.consent.mediaRightsConfirmed
  && profile.consent.aiRepresentationConsent
);

export const resolveTestClonePrerequisites = async ({ companyId, userId, avatarProvider }) => {
  const [profile, brain, avatarState] = await Promise.all([
    DigitalCloneProfile.findOne(owned({ companyId, userId })).lean(),
    DigitalCloneBrainProfile.findOne(owned({ companyId, userId })).lean(),
    getAvatarState({ companyId, userId, provider: avatarProvider }),
  ]);
  const consentReady = baseConsentValid(profile);
  const brainReadiness = calculateDigitalBrainReadiness(brain || {});
  const brainReady = Boolean(brain?.status === "ready" && brainReadiness.ready);
  const generateAsMeReady = Boolean(consentReady && brainReady);
  const avatarReady = Boolean(avatarState.avatar?.readiness?.ready);
  const setup = avatarReady ? await DigitalCloneAvatar.findOne(owned({ companyId, userId })).lean() : null;
  const [candidate, voice, validationVideo] = avatarReady ? await Promise.all([
    DigitalCloneAvatarCandidate.findOne({ _id: setup?.selectedAvatarId, companyId, userId, status: "selected", providerReady: true }).lean(),
    DigitalCloneAvatarProviderVoice.findOne({ _id: setup?.selectedProviderVoiceId, companyId, userId, status: "selected", providerReady: true }).lean(),
    DigitalCloneAvatarVideo.findOne({ _id: setup?.approvedVideoId, companyId, userId, status: "approved", purpose: { $ne: "test-clone" } }).lean(),
  ]) : [null, null, null];
  const configurationReady = Boolean(
    avatarReady && candidate && voice && validationVideo
    && String(validationVideo.avatarId) === String(candidate._id)
    && String(validationVideo.providerVoiceId) === String(voice._id)
  );
  const ready = consentReady && brainReady && generateAsMeReady && configurationReady;
  const needs = [];
  if (!consentReady) needs.push("Complete Digital Clone consent.");
  if (!brainReady) needs.push("Complete Digital Brain setup.");
  if (!generateAsMeReady) needs.push("Complete Generate as Me setup.");
  if (!configurationReady) needs.push("Complete and approve Avatar setup in Step 5.");
  return {
    ready,
    needs: [...new Set(needs)],
    consentReady,
    brainReady,
    generateAsMeReady,
    avatarReady: configurationReady,
    setup,
    candidate,
    voice,
    validationVideo,
  };
};

const requirePrerequisites = async (scope) => {
  const prerequisites = await resolveTestClonePrerequisites(scope);
  if (!prerequisites.ready) throw testCloneError("TEST_CLONE_PREREQUISITES_REQUIRED", "Complete the required Digital Clone setup before using Test Clone.", 409);
  return prerequisites;
};

const normalizeScript = (value) => {
  if (typeof value !== "string") throw testCloneError("TEST_CLONE_SCRIPT_REQUIRED", "Enter a script for Test Clone.");
  const script = value.trim();
  if (!script) throw testCloneError("TEST_CLONE_SCRIPT_REQUIRED", "Enter a script for Test Clone.");
  if (script.length > AVATAR_CONSTANTS.maxScriptCharacters) throw testCloneError("TEST_CLONE_SCRIPT_TOO_LONG", `Test Clone scripts must contain at most ${AVATAR_CONSTANTS.maxScriptCharacters} characters.`);
  return script;
};

const normalizeSettings = (body) => {
  strictObject(body, GENERATION_FIELDS);
  if (!["9:16", "16:9"].includes(body.aspectRatio)) throw testCloneError("TEST_CLONE_SETTINGS_INVALID", "Select a supported video format.");
  if (!["720p", "1080p"].includes(body.resolution)) throw testCloneError("TEST_CLONE_SETTINGS_INVALID", "Select a supported video resolution.");
  if (typeof body.captions !== "boolean") throw testCloneError("TEST_CLONE_SETTINGS_INVALID", "Captions must be on or off.");
  if (!["default", "light", "dark"].includes(body.background)) throw testCloneError("TEST_CLONE_SETTINGS_INVALID", "Select a supported video background.");
  return { aspectRatio: body.aspectRatio, resolution: body.resolution, captions: body.captions, background: body.background };
};

const serializeRecord = (record) => {
  if (!record) return null;
  const value = record.toObject ? record.toObject() : record;
  return {
    id: value._id,
    sourceType: value.sourceType,
    sourceDraftId: value.sourceDraftId,
    originalPrompt: value.originalPrompt,
    script: value.scriptText,
    scriptVersion: value.scriptVersion,
    scriptApproved: Boolean(value.scriptApprovedAt && value.scriptApprovedHash === value.scriptHash),
    scriptApprovedAt: value.scriptApprovedAt,
    settings: value.settings,
    status: value.status,
    failureCode: value.failureCode,
    approvedAt: value.approvedAt,
    rejectedAt: value.rejectedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deliveryPath: ["completed", "approved"].includes(value.status) && value.avatarVideoId ? `/digital-clone/test-clone/${value._id}/delivery` : null,
  };
};

const approvedMatches = (record, video, prerequisites) => Boolean(
  record?.status === "approved"
  && record.approvedAt
  && video?.status === "completed"
  && video.purpose === "test-clone"
  && String(video.testCloneId) === String(record._id)
  && String(video._id) === String(record.avatarVideoId)
  && record.scriptApprovedHash
  && record.scriptApprovedHash === record.generatedScriptHash
  && hashText(video.scriptSnapshot) === record.generatedScriptHash
  && String(record.avatarId) === String(prerequisites.candidate?._id)
  && String(record.providerVoiceId) === String(prerequisites.voice?._id)
  && String(record.avatarValidationVideoId) === String(prerequisites.validationVideo?._id)
);

export const getTestCloneState = async ({ companyId, userId, avatarProvider }) => {
  const prerequisites = await resolveTestClonePrerequisites({ companyId, userId, avatarProvider });
  const records = await DigitalCloneTestClone.find(owned({ companyId, userId })).sort({ createdAt: -1 }).limit(20).lean();
  let approvedArtifact = null;
  if (prerequisites.ready) {
    for (const record of records.filter(({ status }) => status === "approved")) {
      const video = await DigitalCloneAvatarVideo.findOne({ _id: record.avatarVideoId, companyId, userId, testCloneId: record._id, purpose: "test-clone", status: "completed" }).lean();
      if (approvedMatches(record, video, prerequisites)) { approvedArtifact = record; break; }
    }
  }
  const current = records.find((record) => ["script-draft", "script-approved", "queued", "processing", "completed", "failed"].includes(record.status)) || approvedArtifact || records[0] || null;
  const approvedDrafts = prerequisites.ready ? (await DigitalCloneGeneration.find({
    companyId, userId, contentType: "short-video-script", status: "approved",
  }).select("topic approvedAt finalApprovedText").sort({ approvedAt: -1 }).limit(50).lean())
    .filter((draft) => typeof draft.finalApprovedText === "string" && draft.finalApprovedText.trim().length > 0 && draft.finalApprovedText.trim().length <= AVATAR_CONSTANTS.maxScriptCharacters)
    .slice(0, 20).map((draft) => ({ id: draft._id, topic: draft.topic, approvedAt: draft.approvedAt })) : [];
  return {
    readiness: { ready: Boolean(approvedArtifact), status: approvedArtifact ? "ready" : prerequisites.ready ? "in-progress" : "blocked" },
    prerequisites: {
      ready: prerequisites.ready,
      needs: prerequisites.needs,
      consentReady: prerequisites.consentReady,
      brainReady: prerequisites.brainReady,
      generateAsMeReady: prerequisites.generateAsMeReady,
      avatarReady: prerequisites.avatarReady,
    },
    configuration: prerequisites.ready ? {
      avatarName: prerequisites.candidate.displayName,
      voiceName: prerequisites.voice.displayName,
      brainStatus: "Ready",
      generateAsMeStatus: "Ready",
      status: "Ready",
    } : null,
    approvedDrafts,
    current: serializeRecord(current),
    approvedArtifact: serializeRecord(approvedArtifact),
    history: records.map(serializeRecord),
    limits: { maxPromptCharacters: MAX_PROMPT_CHARACTERS, maxScriptCharacters: AVATAR_CONSTANTS.maxScriptCharacters },
  };
};

export const generateTestCloneScript = async ({ company, userId, body, textProvider, avatarProvider }) => {
  strictObject(body, SOURCE_FIELDS);
  if (typeof body.prompt !== "string") throw testCloneError("TEST_CLONE_PROMPT_REQUIRED", "Enter what your clone should create.");
  const prompt = body.prompt.trim();
  if (!prompt) throw testCloneError("TEST_CLONE_PROMPT_REQUIRED", "Enter what your clone should create.");
  if (prompt.length > MAX_PROMPT_CHARACTERS) throw testCloneError("TEST_CLONE_PROMPT_TOO_LONG", `Prompts must contain at most ${MAX_PROMPT_CHARACTERS} characters.`);
  const companyId = company?._id;
  await requirePrerequisites({ companyId, userId, avatarProvider });
  const generated = await generateDigitalCloneText({
    company, userId, provider: textProvider,
    body: { topic: prompt, goal: "Create a concise human-reviewed Test Clone video script.", contentType: "short-video-script", tone: "", length: "short", additionalInstructions: `Keep the complete spoken text within ${AVATAR_CONSTANTS.maxScriptCharacters} characters.` },
  });
  const script = normalizeScript(generated.generatedText);
  return DigitalCloneTestClone.create({ ...owned({ companyId, userId }), sourceType: "new-prompt", originalPrompt: prompt, scriptText: script, scriptHash: hashText(script), scriptVersion: 1, status: "script-draft" });
};

export const createTestCloneFromApprovedDraft = async ({ companyId, userId, body, avatarProvider }) => {
  strictObject(body, DRAFT_FIELDS);
  await requirePrerequisites({ companyId, userId, avatarProvider });
  if (!mongoose.Types.ObjectId.isValid(body.draftId)) throw testCloneError("TEST_CLONE_DRAFT_NOT_FOUND", "Approved draft not found.", 404);
  const draft = await DigitalCloneGeneration.findOne({ _id: body.draftId, companyId, userId, contentType: "short-video-script", status: "approved" }).lean();
  if (!draft?.finalApprovedText) throw testCloneError("TEST_CLONE_DRAFT_NOT_APPROVED", "Select an approved short-video-script draft.", 409);
  const script = normalizeScript(draft.finalApprovedText);
  return DigitalCloneTestClone.create({ ...owned({ companyId, userId }), sourceType: "approved-draft", sourceDraftId: draft._id, scriptText: script, scriptHash: hashText(script), scriptVersion: 1, status: "script-draft" });
};

export const editTestCloneScript = async ({ companyId, userId, testCloneId, body }) => {
  strictObject(body, SCRIPT_FIELDS);
  const script = normalizeScript(body.script);
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  if (!["script-draft", "script-approved"].includes(record.status)) throw testCloneError("TEST_CLONE_SCRIPT_NOT_EDITABLE", "This Test Clone script can no longer be edited.", 409);
  if (record.scriptText === script) return record;
  record.scriptText = script;
  record.scriptHash = hashText(script);
  record.scriptVersion += 1;
  record.scriptApprovedHash = "";
  record.scriptApprovedAt = null;
  record.scriptApprovedBy = null;
  record.status = "script-draft";
  await record.save();
  return record;
};

export const approveTestCloneScript = async ({ companyId, userId, testCloneId, avatarProvider }) => {
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  await requirePrerequisites({ companyId, userId, avatarProvider });
  if (!["script-draft", "script-approved"].includes(record.status)) throw testCloneError("TEST_CLONE_SCRIPT_NOT_APPROVABLE", "This Test Clone script cannot be approved.", 409);
  record.scriptApprovedHash = record.scriptHash;
  record.scriptApprovedAt = new Date();
  record.scriptApprovedBy = userId;
  record.status = "script-approved";
  await record.save();
  return record;
};

export const generateTestCloneVideo = async ({ companyId, userId, testCloneId, body, avatarProvider }) => {
  const settings = normalizeSettings(body);
  await getOwnedTestClone({ companyId, userId, testCloneId });
  const prerequisites = await requirePrerequisites({ companyId, userId, avatarProvider });
  const lock = await DigitalCloneTestClone.findOneAndUpdate({
    _id: testCloneId, companyId, userId, status: { $in: ["script-approved", "failed"] },
    $expr: { $eq: ["$scriptHash", "$scriptApprovedHash"] },
  }, { $set: {
    status: "queued", settings, failureCode: "", avatarVideoId: null,
    avatarId: prerequisites.candidate._id, providerVoiceId: prerequisites.voice._id,
    avatarValidationVideoId: prerequisites.validationVideo._id,
    generatedScriptHash: "",
  } }, { new: true, runValidators: true });
  if (!lock) {
    const existing = await getOwnedTestClone({ companyId, userId, testCloneId });
    if (ACTIVE_VIDEO_STATUSES.has(existing.status)) return existing;
    throw testCloneError("TEST_CLONE_SCRIPT_APPROVAL_REQUIRED", "Approve the current script before generating a Test Clone.", 409);
  }
  try {
    const video = await createAvatarVideo({
      companyId, userId, provider: avatarProvider, purpose: "test-clone", testCloneId: lock._id,
      body: { sourceType: "manual_test", script: lock.scriptText, ...settings },
    });
    return DigitalCloneTestClone.findOneAndUpdate({ _id: lock._id, companyId, userId, status: "queued" }, {
      $set: { avatarVideoId: video._id, status: video.status, generatedScriptHash: lock.scriptHash },
    }, { new: true, runValidators: true });
  } catch (error) {
    await DigitalCloneTestClone.updateOne({ _id: lock._id, companyId, userId, status: "queued" }, { $set: { status: "failed", failureCode: String(error?.code || "TEST_CLONE_GENERATION_FAILED").slice(0, 120) } });
    throw error;
  }
};

const assertBoundVideo = async ({ record, companyId, userId, statuses }) => {
  const video = await DigitalCloneAvatarVideo.findOne({
    _id: record.avatarVideoId, companyId, userId, testCloneId: record._id, purpose: "test-clone", status: { $in: statuses },
  }).select("+storagePublicId");
  if (!video) throw testCloneError("TEST_CLONE_VIDEO_NOT_FOUND", "Test Clone video not found.", 404);
  return video;
};

export const refreshTestCloneVideo = async ({ companyId, userId, testCloneId, avatarProvider, copyVideo, deleteVideo }) => {
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  if (TERMINAL_VIDEO_STATUSES.has(record.status)) return record;
  if (!record.avatarVideoId || !ACTIVE_VIDEO_STATUSES.has(record.status)) throw testCloneError("TEST_CLONE_VIDEO_NOT_FOUND", "Test Clone video not found.", 404);
  await requirePrerequisites({ companyId, userId, avatarProvider });
  const video = await refreshAvatarVideo({ companyId, userId, videoId: record.avatarVideoId, provider: avatarProvider, copyVideo, deleteVideo });
  if (video.purpose !== "test-clone" || String(video.testCloneId) !== String(record._id)) throw testCloneError("TEST_CLONE_VIDEO_NOT_FOUND", "Test Clone video not found.", 404);
  return DigitalCloneTestClone.findOneAndUpdate({ _id: record._id, companyId, userId, status: { $in: ["queued", "processing"] } }, {
    $set: { status: video.status, failureCode: video.failureCode || "" },
  }, { new: true, runValidators: true });
};

export const deliverTestCloneVideo = async ({ companyId, userId, testCloneId, streamVideo }) => {
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  const video = await assertBoundVideo({ record, companyId, userId, statuses: ["completed", "approved"] });
  const delivery = await getAvatarVideoDelivery({ companyId, userId, videoId: video._id, streamVideo });
  return delivery;
};

export const approveTestCloneVideo = async ({ companyId, userId, testCloneId, avatarProvider }) => {
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  const prerequisites = await requirePrerequisites({ companyId, userId, avatarProvider });
  const video = await assertBoundVideo({ record, companyId, userId, statuses: ["completed"] });
  const valid = record.status === "completed"
    && record.scriptApprovedHash === record.scriptHash
    && record.generatedScriptHash === record.scriptApprovedHash
    && hashText(video.scriptSnapshot) === record.generatedScriptHash
    && String(record.avatarId) === String(prerequisites.candidate._id)
    && String(record.providerVoiceId) === String(prerequisites.voice._id)
    && String(record.avatarValidationVideoId) === String(prerequisites.validationVideo._id)
    && String(video.avatarId) === String(prerequisites.candidate._id)
    && String(video.providerVoiceId) === String(prerequisites.voice._id)
    && Boolean(video.storagePublicId);
  if (!valid) throw testCloneError("TEST_CLONE_VIDEO_NOT_APPROVABLE", "This Test Clone no longer matches the approved script and current setup.", 409);
  const approvedAt = new Date();
  const approved = await DigitalCloneTestClone.findOneAndUpdate({
    _id: record._id, companyId, userId, status: "completed",
    scriptHash: record.scriptHash, scriptApprovedHash: record.scriptHash, generatedScriptHash: record.scriptHash,
    avatarId: prerequisites.candidate._id, providerVoiceId: prerequisites.voice._id,
    avatarValidationVideoId: prerequisites.validationVideo._id, avatarVideoId: video._id,
  }, { $set: { status: "approved", approvedAt, approvedBy: userId } }, { new: true, runValidators: true });
  if (!approved) throw testCloneError("TEST_CLONE_VIDEO_NOT_APPROVABLE", "This Test Clone could not be approved because its setup changed.", 409);
  const stillValid = await DigitalCloneAvatarVideo.exists({ _id: video._id, companyId, userId, testCloneId: record._id, purpose: "test-clone", status: "completed" });
  const currentPrerequisites = stillValid ? await resolveTestClonePrerequisites({ companyId, userId, avatarProvider }) : null;
  const configurationStillValid = currentPrerequisites?.ready
    && String(record.avatarId) === String(currentPrerequisites.candidate?._id)
    && String(record.providerVoiceId) === String(currentPrerequisites.voice?._id)
    && String(record.avatarValidationVideoId) === String(currentPrerequisites.validationVideo?._id);
  if (!stillValid || !configurationStillValid) {
    await DigitalCloneTestClone.updateOne({ _id: approved._id, companyId, userId, status: "approved" }, { $set: { status: "rejected", rejectedAt: new Date() } });
    throw testCloneError("TEST_CLONE_VIDEO_NOT_APPROVABLE", "This Test Clone could not be approved because its video changed.", 409);
  }
  return approved;
};

export const rejectTestCloneVideo = async ({ companyId, userId, testCloneId }) => {
  const record = await getOwnedTestClone({ companyId, userId, testCloneId });
  if (!["completed", "failed", "approved"].includes(record.status)) throw testCloneError("TEST_CLONE_VIDEO_NOT_REJECTABLE", "This Test Clone video cannot be rejected.", 409);
  if (record.avatarVideoId) await rejectAvatarVideo({ companyId, userId, videoId: record.avatarVideoId, purpose: "test-clone" });
  const rejected = await DigitalCloneTestClone.findOneAndUpdate({ _id: record._id, companyId, userId, status: { $in: ["completed", "failed", "approved"] } }, {
    $set: { status: "rejected", rejectedAt: new Date() },
  }, { new: true, runValidators: true });
  if (!rejected) throw testCloneError("TEST_CLONE_VIDEO_NOT_REJECTABLE", "This Test Clone video cannot be rejected.", 409);
  return rejected;
};

export const serializeTestClone = serializeRecord;
export const TEST_CLONE_CONSTANTS = Object.freeze({ maxPromptCharacters: MAX_PROMPT_CHARACTERS, maxScriptCharacters: AVATAR_CONSTANTS.maxScriptCharacters });
