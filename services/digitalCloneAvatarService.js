import { createHash } from "node:crypto";
import mongoose from "mongoose";
import DigitalCloneAvatar from "../models/digitalCloneAvatar.js";
import DigitalCloneAvatarCandidate from "../models/digitalCloneAvatarCandidate.js";
import DigitalCloneAvatarProviderVoice from "../models/digitalCloneAvatarProviderVoice.js";
import DigitalCloneAvatarVideo from "../models/digitalCloneAvatarVideo.js";
import DigitalCloneGeneration from "../models/digitalCloneGeneration.js";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import { resolveAvatarProvider } from "../providers/digitalCloneAvatar/index.js";
import { copyProviderVideoToPrivateStorage, deletePrivateAvatarVideo, streamHeyGenPreview, streamPrivateAvatarVideo } from "./digitalCloneAvatarStorageService.js";

const CONSENT_VERSION = "1.0";
const MAX_SCRIPT_CHARACTERS = 1200;
const CANDIDATE_IDENTITY_INDEX_FIELDS = ["companyId", "providerKeyHash", "userId"];
const CONSENT_FIELDS = new Set(["appearanceOwnershipOrAuthorization", "avatarGenerationAuthorized", "providerProcessingAuthorized", "revocationUnderstood"]);
const VIDEO_FIELDS = new Set(["sourceType", "draftId", "script", "aspectRatio", "resolution", "captions", "background"]);
export const avatarServiceError = (code, message, statusCode = 400) => { const error = new Error(message); error.code = code; error.statusCode = statusCode; return error; };
const owned = ({ companyId, userId }) => ({ companyId, userId });
const validId = (id, code = "AVATAR_NOT_FOUND") => { if (!mongoose.Types.ObjectId.isValid(id)) { const messages = { AVATAR_VIDEO_NOT_FOUND: "Avatar video not found.", AVATAR_PROVIDER_VOICE_NOT_FOUND: "Avatar voice not found.", DRAFT_NOT_FOUND: "Draft not found." }; throw avatarServiceError(code, messages[code] || "Avatar not found.", 404); } return id; };
const strictObject = (body, fields, code) => { if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((field) => !fields.has(field))) throw avatarServiceError(code, "Avatar request contains invalid fields."); };
const sanitizeProviderError = (error) => {
  if (String(error?.code || "").startsWith("AVATAR_")) return error;
  return avatarServiceError("AVATAR_PROVIDER_UNAVAILABLE", "TerraPeak Avatar is temporarily unavailable.", 503);
};
const providerAvailability = (injectedProvider) => { try { const provider = injectedProvider || resolveAvatarProvider(); return { available: true, provider }; } catch (error) { return { available: false, code: "AVATAR_PROVIDER_NOT_CONFIGURED", provider: null }; } };
const isCandidateIdentityDuplicate = (error) => {
  if (error?.code !== 11000) return false;
  const fields = Object.keys(error.keyPattern || {}).sort();
  return fields.length === CANDIDATE_IDENTITY_INDEX_FIELDS.length && fields.every((field, index) => field === CANDIDATE_IDENTITY_INDEX_FIELDS[index]);
};
const baseConsentValid = async ({ companyId, userId }) => {
  const profile = await DigitalCloneProfile.findOne({ companyId, userId }).select("status consent").lean(); const consent = profile?.consent;
  return Boolean(["consented", "setup"].includes(profile?.status) && consent?.acceptedAt && consent.identityConfirmed && consent.mediaRightsConfirmed && consent.aiRepresentationConsent);
};
const avatarConsentCurrent = (avatar) => Boolean(avatar?.consent?.acceptedAt && !avatar?.consent?.revokedAt && avatar.consent.appearanceOwnershipOrAuthorization && avatar.consent.avatarGenerationAuthorized && avatar.consent.providerProcessingAuthorized && avatar.consent.revocationUnderstood);
export const assertAvatarConsent = async ({ companyId, userId }) => {
  if (!(await baseConsentValid({ companyId, userId }))) throw avatarServiceError("DIGITAL_CLONE_AVATAR_BASE_CONSENT_REQUIRED", "Complete Digital Clone identity, media, and AI representation consent first.", 403);
  const avatar = await DigitalCloneAvatar.findOne(owned({ companyId, userId })).select("+provider");
  if (!avatarConsentCurrent(avatar) || avatar.status === "revoked") throw avatarServiceError("AVATAR_CONSENT_REQUIRED", "Explicit avatar authorization is required.", 403);
  return avatar;
};
const candidateProjection = "+provider +providerKeyHash +providerAvatarGroupRef +providerAvatarLookRef +providerDefaultVoiceRef +previewImageUrl";
const providerVoiceProjection = "+provider +providerKeyHash +providerVoiceRef";
const serializeCandidate = (candidate) => { const value = candidate?.toObject ? candidate.toObject() : candidate; return { id: value._id, displayName: value.displayName, avatarType: value.avatarType, orientation: value.orientation, supportedCapabilities: value.supportedCapabilities, providerReady: value.providerReady, status: value.status, previewPath: `/digital-clone/avatar/available/${value._id}/preview` }; };
const serializeProviderVoice = (voice) => { const value = voice?.toObject ? voice.toObject() : voice; return { id: value._id, displayName: value.displayName, language: value.language, gender: value.gender, voiceType: value.voiceType, providerReady: value.providerReady, status: value.status }; };
export const serializeAvatarVideo = (video) => { const value = video?.toObject ? video.toObject() : video; return { id: value._id, avatarId: value.avatarId, sourceDraftId: value.sourceDraftId, sourceType: value.sourceType, scriptSnapshot: value.scriptSnapshot, aspectRatio: value.aspectRatio, resolution: value.resolution, captions: value.captions, background: value.background, status: value.status, failureCode: value.failureCode, durationSeconds: value.durationSeconds, approvedAt: value.approvedAt, createdAt: value.createdAt, updatedAt: value.updatedAt, deliveryPath: ["completed", "approved"].includes(value.status) ? `/digital-clone/avatar/videos/${value._id}/delivery` : null }; };
const readiness = ({ avatar, selected, selectedVoice, available, authorized }) => {
  const reasons = [];
  if (!available) reasons.push("provider-unavailable"); if (!authorized) reasons.push("authorization-required");
  if (!selected || selected.status !== "selected" || !selected.providerReady) reasons.push("avatar-not-ready");
  if (!selectedVoice || selectedVoice.status !== "selected" || !selectedVoice.providerReady) reasons.push("provider-voice-not-ready");
  if (!avatar?.approvedAt || !avatar?.approvedVideoId) reasons.push("human-approval-required"); if (avatar?.status === "revoked") reasons.push("revoked");
  return { ready: reasons.length === 0, reasons };
};
export const acceptAvatarConsent = async ({ companyId, userId, body, acceptedIp }) => {
  strictObject(body, CONSENT_FIELDS, "AVATAR_CONSENT_INVALID"); if (!(await baseConsentValid({ companyId, userId }))) throw avatarServiceError("DIGITAL_CLONE_AVATAR_BASE_CONSENT_REQUIRED", "Complete Digital Clone consent first.", 403);
  if ([...CONSENT_FIELDS].some((field) => body[field] !== true)) throw avatarServiceError("AVATAR_CONSENT_REQUIRED", "All avatar authorization confirmations are required.");
  const existing = await DigitalCloneAvatar.findOne(owned({ companyId, userId }));
  const wasRevoked = existing?.status === "revoked" || existing?.consent?.revokedAt;
  const $set = { revokedAt: null, consent: { ...Object.fromEntries([...CONSENT_FIELDS].map((field) => [field, true])), version: CONSENT_VERSION, acceptedAt: new Date(), acceptedIp: String(acceptedIp || "").slice(0, 200), revokedAt: null } };
  if (!existing || wasRevoked) Object.assign($set, { status: "not_started", selectedAvatarId: null, selectedProviderVoiceId: null, approvedAt: null, approvedVideoId: null });
  return DigitalCloneAvatar.findOneAndUpdate(owned({ companyId, userId }), { $set, $setOnInsert: owned({ companyId, userId }) }, { upsert: true, new: true, runValidators: true });
};
export const discoverAvatars = async ({ companyId, userId, provider: injectedProvider }) => {
  await assertAvatarConsent({ companyId, userId }); const provider = injectedProvider || resolveAvatarProvider(); let values;
  try { values = await provider.listAvatars({ diagnostic: true }); } catch (error) { throw sanitizeProviderError(error); }
  if (!Array.isArray(values)) throw avatarServiceError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid response.", 502);
  const normalized = new Map();
  for (const value of values.slice(0, 200)) {
    const groupRef = String(value?.groupRef || ""); const lookRef = String(value?.lookRef || "");
    if (!groupRef || !lookRef) continue;
    const identity = `${provider.name}:${groupRef}:${lookRef}`;
    normalized.set(identity, { value, groupRef, lookRef, hash: createHash("sha256").update(identity).digest("hex") });
  }
  const now = new Date(); const seen = [...normalized.values()].map(({ hash }) => hash);
  for (const { value, groupRef, lookRef, hash } of normalized.values()) {
    const avatarType = ["photo-avatar", "digital-twin", "studio-avatar"].includes(value.avatarType) ? value.avatarType : "unknown";
    const orientation = ["portrait", "landscape", "square"].includes(value.orientation) ? value.orientation : "unknown";
    const filter = { companyId, userId, providerKeyHash: hash };
    const update = [{ $set: { provider: provider.name, providerAvatarGroupRef: groupRef.slice(0, 500), providerAvatarLookRef: lookRef.slice(0, 500), providerDefaultVoiceRef: String(value.defaultVoiceRef || "").slice(0, 500), previewImageUrl: String(value.previewImageUrl || "").slice(0, 2000), displayName: String(value.displayName || "TerraPeak Avatar").slice(0, 200), avatarType, orientation, supportedCapabilities: (value.supportedCapabilities || []).filter((item) => ["avatar_v", "avatar_iv"].includes(item)), providerReady: Boolean(value.ready), status: { $cond: [{ $and: [{ $eq: ["$status", "selected"] }, Boolean(value.ready)] }, "selected", value.ready ? "discovered" : "unavailable"] }, lastDiscoveredAt: now, revokedAt: null, createdAt: { $ifNull: ["$createdAt", now] }, updatedAt: now } }];
    try { await DigitalCloneAvatarCandidate.findOneAndUpdate(filter, update, { upsert: true, new: true }); }
    catch (error) {
      if (!isCandidateIdentityDuplicate(error)) throw error;
      const reconciled = await DigitalCloneAvatarCandidate.findOneAndUpdate(filter, update, { new: true });
      if (!reconciled) throw error;
    }
  }
  await DigitalCloneAvatarCandidate.updateMany({ companyId, userId, provider: provider.name, providerKeyHash: { $nin: seen }, status: { $ne: "revoked" } }, { $set: { status: "unavailable", providerReady: false } });
  return DigitalCloneAvatarCandidate.find({ companyId, userId, status: { $ne: "revoked" } }).sort({ providerReady: -1, displayName: 1 });
};
export const discoverAvatarProviderVoices = async ({ companyId, userId, provider: injectedProvider }) => {
  await assertAvatarConsent({ companyId, userId }); const provider = injectedProvider || resolveAvatarProvider(); let values;
  try { values = await provider.listVoices(); } catch (error) { throw sanitizeProviderError(error); }
  if (!Array.isArray(values)) throw avatarServiceError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid response.", 502);
  const normalized = new Map();
  for (const value of values.slice(0, 300)) {
    const voiceRef = String(value?.voiceRef || ""); if (!voiceRef) continue;
    const identity = `${provider.name}:${voiceRef}`;
    normalized.set(identity, { value, voiceRef, hash: createHash("sha256").update(identity).digest("hex") });
  }
  const now = new Date(); const seen = [...normalized.values()].map(({ hash }) => hash);
  for (const { value, voiceRef, hash } of normalized.values()) {
    const displayName = String(value.displayName || "Unavailable Avatar voice").trim().slice(0, 200);
    const language = String(value.language || "Unknown").trim().slice(0, 100);
    const gender = ["male", "female", "neutral"].includes(value.gender) ? value.gender : "unknown";
    const voiceType = ["public", "private"].includes(value.voiceType) ? value.voiceType : "unknown";
    const providerReady = Boolean(value.ready && value.displayName);
    const filter = { companyId, userId, providerKeyHash: hash };
    const update = [{ $set: { provider: provider.name, providerVoiceRef: voiceRef.slice(0, 500), displayName, language, gender, voiceType, providerReady, status: { $cond: [{ $and: [{ $eq: ["$status", "selected"] }, providerReady] }, "selected", providerReady ? "discovered" : "unavailable"] }, lastDiscoveredAt: now, revokedAt: null, createdAt: { $ifNull: ["$createdAt", now] }, updatedAt: now } }];
    try { await DigitalCloneAvatarProviderVoice.findOneAndUpdate(filter, update, { upsert: true, new: true }); }
    catch (error) {
      if (!isCandidateIdentityDuplicate(error)) throw error;
      const reconciled = await DigitalCloneAvatarProviderVoice.findOneAndUpdate(filter, update, { new: true });
      if (!reconciled) throw error;
    }
  }
  await DigitalCloneAvatarProviderVoice.updateMany({ companyId, userId, provider: provider.name, providerKeyHash: { $nin: seen }, status: { $ne: "revoked" } }, { $set: { status: "unavailable", providerReady: false } });
  return DigitalCloneAvatarProviderVoice.find({ companyId, userId, status: { $ne: "revoked" } }).sort({ providerReady: -1, displayName: 1 });
};
const findCandidate = async ({ companyId, userId, candidateId }) => { validId(candidateId); const candidate = await DigitalCloneAvatarCandidate.findOne({ _id: candidateId, companyId, userId, status: { $ne: "revoked" } }).select(candidateProjection); if (!candidate) throw avatarServiceError("AVATAR_NOT_FOUND", "Avatar not found.", 404); return candidate; };
const findProviderVoice = async ({ companyId, userId, voiceId }) => { validId(voiceId, "AVATAR_PROVIDER_VOICE_NOT_FOUND"); const voice = await DigitalCloneAvatarProviderVoice.findOne({ _id: voiceId, companyId, userId, status: { $ne: "revoked" } }).select(providerVoiceProjection); if (!voice) throw avatarServiceError("AVATAR_PROVIDER_VOICE_NOT_FOUND", "Avatar voice not found.", 404); return voice; };
export const selectAvatar = async ({ companyId, userId, candidateId, provider: injectedProvider }) => {
  const setup = await assertAvatarConsent({ companyId, userId }); const candidate = await findCandidate({ companyId, userId, candidateId }); const provider = injectedProvider || resolveAvatarProvider(candidate.provider);
  let current; try { current = await provider.getAvatar({ groupRef: candidate.providerAvatarGroupRef, lookRef: candidate.providerAvatarLookRef }); } catch (error) { throw sanitizeProviderError(error); }
  if (!current?.ready || current.groupRef !== candidate.providerAvatarGroupRef || current.lookRef !== candidate.providerAvatarLookRef) throw avatarServiceError("AVATAR_NOT_READY", "Select a provider-ready private avatar.", 409);
  await DigitalCloneAvatarCandidate.updateMany({ companyId, userId, status: "selected", _id: { $ne: candidate._id } }, { $set: { status: "discovered" } }); candidate.status = "selected"; candidate.providerReady = true;
  try { await candidate.save(); } catch (error) { if (error?.code === 11000) throw avatarServiceError("AVATAR_SELECTION_CONFLICT", "Another avatar selection is already in progress.", 409); throw error; }
  const updatedSetup = await DigitalCloneAvatar.findOneAndUpdate({ _id: setup._id, companyId, userId, status: { $ne: "revoked" }, "consent.revokedAt": null }, { $set: { provider: provider.name, selectedAvatarId: candidate._id, status: "selected", approvedAt: null, approvedVideoId: null, lastErrorCode: "" } }, { new: true, runValidators: true });
  if (!updatedSetup) { await DigitalCloneAvatarCandidate.updateOne({ _id: candidate._id, companyId, userId }, { $set: { status: "revoked", providerReady: false, revokedAt: new Date() } }); throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during selection.", 409); }
  return candidate;
};
export const selectAvatarProviderVoice = async ({ companyId, userId, voiceId, provider: injectedProvider }) => {
  const setup = await assertAvatarConsent({ companyId, userId }); const voice = await findProviderVoice({ companyId, userId, voiceId }); const provider = injectedProvider || resolveAvatarProvider(voice.provider);
  let current; try { current = await provider.getVoice({ voiceRef: voice.providerVoiceRef }); } catch (error) { throw sanitizeProviderError(error); }
  if (!current?.ready || current.voiceRef !== voice.providerVoiceRef) throw avatarServiceError("AVATAR_PROVIDER_VOICE_NOT_READY", "Select an available Avatar voice.", 409);
  await DigitalCloneAvatarProviderVoice.updateMany({ companyId, userId, status: "selected", _id: { $ne: voice._id } }, { $set: { status: "discovered" } }); voice.status = "selected"; voice.providerReady = true;
  try { await voice.save(); } catch (error) { if (error?.code === 11000) throw avatarServiceError("AVATAR_PROVIDER_VOICE_SELECTION_CONFLICT", "Another Avatar voice selection is already in progress.", 409); throw error; }
  const updatedSetup = await DigitalCloneAvatar.findOneAndUpdate({ _id: setup._id, companyId, userId, status: { $ne: "revoked" }, "consent.revokedAt": null }, { $set: { provider: provider.name, selectedProviderVoiceId: voice._id, approvedAt: null, approvedVideoId: null, lastErrorCode: "" } }, { new: true, runValidators: true });
  if (!updatedSetup) { await DigitalCloneAvatarProviderVoice.updateOne({ _id: voice._id, companyId, userId }, { $set: { status: "revoked", providerReady: false, revokedAt: new Date() } }); throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during voice selection.", 409); }
  return voice;
};
export const getAvatarProviderVoiceState = async ({ companyId, userId }) => {
  const setup = await assertAvatarConsent({ companyId, userId }); const voices = await DigitalCloneAvatarProviderVoice.find({ companyId, userId, status: { $ne: "revoked" } }).sort({ providerReady: -1, displayName: 1 });
  return { selectedProviderVoiceId: setup.selectedProviderVoiceId || null, availableProviderVoices: voices.map(serializeProviderVoice) };
};
const normalizeVideoInput = async ({ companyId, userId, body }) => {
  strictObject(body, VIDEO_FIELDS, "AVATAR_VIDEO_INVALID"); const sourceType = body.sourceType;
  if (!new Set(["approved-draft", "manual-test"]).has(sourceType)) throw avatarServiceError("AVATAR_VIDEO_INVALID", "Select an approved draft or short test script.");
  let script; let sourceDraftId = null;
  if (sourceType === "approved-draft") { validId(body.draftId, "DRAFT_NOT_FOUND"); const draft = await DigitalCloneGeneration.findOne({ _id: body.draftId, companyId, userId, contentType: "short-video-script", status: "approved" }).lean(); if (!draft?.finalApprovedText) throw avatarServiceError("DRAFT_NOT_APPROVED", "Select an approved short-video-script draft.", 409); script = draft.finalApprovedText; sourceDraftId = draft._id; }
  else { if (typeof body.script !== "string") throw avatarServiceError("AVATAR_VIDEO_INVALID", "Short test script is required."); script = body.script.trim(); }
  if (!script || script.length > MAX_SCRIPT_CHARACTERS) throw avatarServiceError("AVATAR_SCRIPT_TOO_LONG", `Avatar scripts must contain 1 to ${MAX_SCRIPT_CHARACTERS} characters.`);
  const aspectRatio = ["9:16", "16:9"].includes(body.aspectRatio) ? body.aspectRatio : "9:16"; const resolution = ["720p", "1080p"].includes(body.resolution) ? body.resolution : "720p";
  if (body.captions !== undefined && typeof body.captions !== "boolean") throw avatarServiceError("AVATAR_VIDEO_INVALID", "captions must be true or false."); const background = ["default", "light", "dark"].includes(body.background) ? body.background : "default";
  return { sourceType, sourceDraftId, scriptSnapshot: script, aspectRatio, resolution, captions: Boolean(body.captions), background };
};
export const createAvatarVideo = async ({ companyId, userId, body, provider: injectedProvider }) => {
  const setup = await assertAvatarConsent({ companyId, userId }); const input = await normalizeVideoInput({ companyId, userId, body }); if (!setup.selectedAvatarId) throw avatarServiceError("AVATAR_NOT_READY", "Select an avatar first.", 409);
  const candidate = await findCandidate({ companyId, userId, candidateId: setup.selectedAvatarId }); if (candidate.status !== "selected" || !candidate.providerReady) throw avatarServiceError("AVATAR_NOT_READY", "Selected avatar is not ready.", 409);
  if (!setup.selectedProviderVoiceId) throw avatarServiceError("AVATAR_PROVIDER_VOICE_NOT_READY", "Select an Avatar voice first.", 409);
  const voice = await findProviderVoice({ companyId, userId, voiceId: setup.selectedProviderVoiceId }); if (voice.status !== "selected" || !voice.providerReady) throw avatarServiceError("AVATAR_PROVIDER_VOICE_NOT_READY", "Selected Avatar voice is not ready.", 409);
  if (candidate.provider !== voice.provider) throw avatarServiceError("AVATAR_PROVIDER_VOICE_NOT_READY", "Selected Avatar voice is not compatible with the selected avatar.", 409);
  const dedupeKey = createHash("sha256").update(JSON.stringify({ avatar: String(candidate._id), voice: String(voice._id), ...input })).digest("hex"); let video;
  try { video = await DigitalCloneAvatarVideo.create({ ...owned({ companyId, userId }), avatarId: candidate._id, providerVoiceId: voice._id, sourceDraftId: input.sourceDraftId, sourceType: input.sourceType, scriptSnapshot: input.scriptSnapshot, aspectRatio: input.aspectRatio, resolution: input.resolution, captions: input.captions, background: input.background, status: "queued", dedupeKey, activeDedupeKey: dedupeKey }); }
  catch (error) { if (error?.code === 11000) return DigitalCloneAvatarVideo.findOne({ companyId, userId, activeDedupeKey: dedupeKey }); throw error; }
  const provider = injectedProvider || resolveAvatarProvider(setup.provider); try {
    const result = await provider.createVideo({ avatar: { lookRef: candidate.providerAvatarLookRef, supportedCapabilities: candidate.supportedCapabilities }, voice: { voiceRef: voice.providerVoiceRef }, script: input.scriptSnapshot, aspectRatio: input.aspectRatio, resolution: input.resolution, captions: input.captions, background: input.background, idempotencyKey: String(video._id) });
    if (!result?.jobRef) throw avatarServiceError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid response.", 502);
    const current = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: video._id, companyId, userId, status: "queued" }, { $set: { provider: provider.name, providerJobRef: result.jobRef, status: "processing" } }, { new: true, runValidators: true });
    if (!current) { await provider.deleteGeneratedVideo?.({ jobRef: result.jobRef }).catch(() => null); throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during generation.", 409); }
    return current;
  } catch (error) { await DigitalCloneAvatarVideo.updateOne({ _id: video._id, companyId, userId, status: "queued" }, { $set: { status: "failed", failureCode: String(error?.code || "AVATAR_PROVIDER_UNAVAILABLE").slice(0, 120), activeDedupeKey: null } }); throw sanitizeProviderError(error); }
};
const findVideo = async ({ companyId, userId, videoId, privateFields = false }) => { validId(videoId, "AVATAR_VIDEO_NOT_FOUND"); let query = DigitalCloneAvatarVideo.findOne({ _id: videoId, companyId, userId }); if (privateFields) query = query.select("+provider +providerJobRef +providerResultUrl +storagePublicId +dedupeKey +activeDedupeKey"); const video = await query; if (!video) throw avatarServiceError("AVATAR_VIDEO_NOT_FOUND", "Avatar video not found.", 404); return video; };
export const refreshAvatarVideo = async ({ companyId, userId, videoId, provider: injectedProvider, copyVideo = copyProviderVideoToPrivateStorage, deleteVideo = deletePrivateAvatarVideo }) => {
  await assertAvatarConsent({ companyId, userId }); const video = await findVideo({ companyId, userId, videoId, privateFields: true }); if (!new Set(["queued", "processing"]).has(video.status)) return video;
  const provider = injectedProvider || resolveAvatarProvider(video.provider); let result; try { result = await provider.getVideoStatus({ jobRef: video.providerJobRef }); } catch (error) { throw sanitizeProviderError(error); }
  if (result.status === "processing") { const current = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: video._id, companyId, userId, status: { $in: ["queued", "processing"] } }, { $set: { status: "processing" } }, { new: true }); if (!current) throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during generation.", 409); return current; }
  if (result.status === "failed") { const failed = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: video._id, companyId, userId, status: { $in: ["queued", "processing"] } }, { $set: { status: "failed", failureCode: String(result.failureCode || "AVATAR_VIDEO_FAILED").slice(0, 120), activeDedupeKey: null } }, { new: true }); if (!failed) throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during generation.", 409); return failed; }
  if (result.status !== "completed" || !result.resultUrl) throw avatarServiceError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid response.", 502);
  const setup = await assertAvatarConsent({ companyId, userId }); if (String(setup.selectedAvatarId) !== String(video.avatarId) || String(setup.selectedProviderVoiceId) !== String(video.providerVoiceId)) throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during generation.", 409);
  const selectedVoice = await DigitalCloneAvatarProviderVoice.findOne({ _id: video.providerVoiceId, companyId, userId, status: "selected", providerReady: true }); if (!selectedVoice) throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar voice authorization changed during generation.", 409);
  const upload = await copyVideo({ resultUrl: result.resultUrl, companyId, userId, videoId: video._id });
  const completed = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: video._id, companyId, userId, status: { $in: ["queued", "processing"] } }, { $set: { storagePublicId: upload.public_id, mimeType: "video/mp4", bytes: upload.bytes || 0, durationSeconds: result.durationSeconds, status: "completed", completedAt: new Date() } }, { new: true, runValidators: true });
  if (!completed) { try { await deleteVideo({ storagePublicId: upload.public_id }); } catch { /* retain denial even when storage reconciliation is required */ } throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during generation.", 409); }
  return completed;
};
export const getAvatarVideoDelivery = async ({ companyId, userId, videoId, streamVideo = streamPrivateAvatarVideo }) => { await assertAvatarConsent({ companyId, userId }); const video = await findVideo({ companyId, userId, videoId, privateFields: true }); if (!["completed", "approved"].includes(video.status) || !video.storagePublicId) throw avatarServiceError("AVATAR_VIDEO_NOT_FOUND", "Avatar video not found.", 404); return { video, stream: await streamVideo({ storagePublicId: video.storagePublicId }) }; };
export const getAvatarPreviewDelivery = async ({ companyId, userId, candidateId, streamPreview = streamHeyGenPreview }) => { await assertAvatarConsent({ companyId, userId }); const candidate = await findCandidate({ companyId, userId, candidateId }); if (!candidate.previewImageUrl) throw avatarServiceError("AVATAR_PREVIEW_UNAVAILABLE", "Avatar preview is unavailable.", 404); return streamPreview({ previewUrl: candidate.previewImageUrl }); };
export const approveAvatarVideo = async ({ companyId, userId, videoId }) => { const setup = await assertAvatarConsent({ companyId, userId }); const video = await findVideo({ companyId, userId, videoId, privateFields: true }); if (video.status !== "completed" || !video.storagePublicId || String(video.avatarId) !== String(setup.selectedAvatarId)) throw avatarServiceError("AVATAR_VIDEO_NOT_APPROVABLE", "Complete and review the selected avatar video before approval.", 409); const approvedAt = new Date(); await DigitalCloneAvatarVideo.updateMany({ companyId, userId, status: "approved", _id: { $ne: video._id } }, { $set: { status: "completed", approvedAt: null } }); const approved = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: video._id, companyId, userId, status: "completed" }, { $set: { status: "approved", approvedAt } }, { new: true, runValidators: true }); if (!approved) throw avatarServiceError("AVATAR_VIDEO_NOT_APPROVABLE", "Complete and review the selected avatar video before approval.", 409); const readySetup = await DigitalCloneAvatar.findOneAndUpdate({ _id: setup._id, companyId, userId, status: { $ne: "revoked" }, selectedAvatarId: video.avatarId, "consent.revokedAt": null }, { $set: { status: "ready", approvedAt, approvedVideoId: video._id } }, { new: true, runValidators: true }); if (!readySetup) { await DigitalCloneAvatarVideo.updateOne({ _id: video._id, companyId, userId, status: "approved" }, { $set: { status: "archived", approvedAt: null, activeDedupeKey: null } }); throw avatarServiceError("AVATAR_AUTHORIZATION_CHANGED", "Avatar authorization changed during approval.", 409); } return approved; };
export const rejectAvatarVideo = async ({ companyId, userId, videoId }) => { await assertAvatarConsent({ companyId, userId }); validId(videoId, "AVATAR_VIDEO_NOT_FOUND"); const video = await DigitalCloneAvatarVideo.findOneAndUpdate({ _id: videoId, companyId, userId, status: { $in: ["completed", "failed"] } }, { $set: { status: "rejected", rejectedAt: new Date(), activeDedupeKey: null } }, { new: true }); if (!video) throw avatarServiceError("AVATAR_VIDEO_NOT_REJECTABLE", "This avatar video cannot be rejected.", 409); return video; };
export const revokeAvatar = async ({ companyId, userId }) => { const setup = await DigitalCloneAvatar.findOne(owned({ companyId, userId })); if (!setup) throw avatarServiceError("AVATAR_NOT_FOUND", "Avatar setup not found.", 404); if (setup.status === "revoked") return setup; const now = new Date(); const revoked = await DigitalCloneAvatar.findOneAndUpdate({ _id: setup._id, companyId, userId, status: { $ne: "revoked" } }, { $set: { status: "revoked", revokedAt: now, selectedProviderVoiceId: null, approvedAt: null, approvedVideoId: null, "consent.revokedAt": now } }, { new: true, runValidators: true }); await DigitalCloneAvatarCandidate.updateMany({ companyId, userId, status: "selected" }, { $set: { status: "revoked", revokedAt: now, providerReady: false } }); await DigitalCloneAvatarProviderVoice.updateMany({ companyId, userId, status: "selected" }, { $set: { status: "revoked", revokedAt: now, providerReady: false } }); await DigitalCloneAvatarVideo.updateMany({ companyId, userId, status: { $in: ["queued", "processing", "completed", "approved"] } }, { $set: { status: "archived", approvedAt: null, activeDedupeKey: null } }); return revoked || setup; };
export const getAvatarState = async ({ companyId, userId, provider: injectedProvider }) => {
  const setup = await DigitalCloneAvatar.findOne(owned({ companyId, userId })); const availability = providerAvailability(injectedProvider); const authorized = avatarConsentCurrent(setup) && await baseConsentValid({ companyId, userId }); const candidates = authorized ? await DigitalCloneAvatarCandidate.find({ companyId, userId, status: { $ne: "revoked" } }).sort({ providerReady: -1, displayName: 1 }) : [];
  const providerVoices = authorized ? await DigitalCloneAvatarProviderVoice.find({ companyId, userId, status: { $ne: "revoked" } }).sort({ providerReady: -1, displayName: 1 }) : [];
  const selected = candidates.find((candidate) => String(candidate._id) === String(setup?.selectedAvatarId)); const selectedVoice = providerVoices.find((voice) => String(voice._id) === String(setup?.selectedProviderVoiceId)); const videos = authorized ? await DigitalCloneAvatarVideo.find({ companyId, userId }).sort({ createdAt: -1 }).limit(20) : [];
  const drafts = await DigitalCloneGeneration.find({ companyId, userId, contentType: "short-video-script", status: "approved" }).select("topic finalApprovedText approvedAt").sort({ approvedAt: -1 }).limit(20).lean();
  return { avatar: { status: setup?.status || "not_started", consent: setup?.consent || null, selectedAvatarId: authorized ? setup?.selectedAvatarId || null : null, selectedProviderVoiceId: authorized ? setup?.selectedProviderVoiceId || null : null, approvedAt: authorized ? setup?.approvedAt || null : null, readiness: readiness({ avatar: setup, selected, selectedVoice, available: availability.available, authorized }) }, providerAvailability: { available: availability.available, ...(!availability.available ? { code: availability.code } : {}) }, availableAvatars: candidates.map(serializeCandidate), availableProviderVoices: providerVoices.map(serializeProviderVoice), videos: videos.map(serializeAvatarVideo), approvedDrafts: drafts.map((draft) => ({ id: draft._id, topic: draft.topic, text: draft.finalApprovedText, approvedAt: draft.approvedAt })), limits: { maxScriptCharacters: MAX_SCRIPT_CHARACTERS, generationPerHour: 3 } };
};
export const AVATAR_CONSTANTS = Object.freeze({ consentVersion: CONSENT_VERSION, maxScriptCharacters: MAX_SCRIPT_CHARACTERS });
