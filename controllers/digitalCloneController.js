import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import {
  getDigitalBrain,
  saveDigitalBrain,
} from "../services/digitalCloneBrainService.js";
import {
  approveDigitalCloneDraft,
  editDigitalCloneDraft,
  generateDigitalCloneDraft,
  getDigitalCloneDraft,
  listDigitalCloneDrafts,
  serializeGeneration,
  setDigitalCloneDraftStatus,
} from "../services/digitalCloneGenerationService.js";
import {
  deleteIdentityAsset,
  getIdentityAssetDeliveryStream,
  listIdentityAssets,
  revokeIdentityAsset,
  serializeIdentityAsset,
  updateIdentityAsset,
  uploadIdentityAssets,
} from "../services/digitalCloneVisualIdentityService.js";

const profileError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "DIGITAL_CLONE_PROFILE_INVALID";
  return error;
};

const normalizeList = (value, field, limit = 30) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw profileError(`${field} must contain at most ${limit} items.`);
  }
  const seen = new Set();
  return value.reduce((items, item) => {
    if (typeof item !== "string") throw profileError(`${field} entries must be text.`);
    const cleaned = item.trim();
    if (!cleaned) return items;
    if (cleaned.length > 300) throw profileError(`${field} entries are too long.`);
    const key = cleaned.toLocaleLowerCase("en");
    if (!seen.has(key)) {
      seen.add(key);
      items.push(cleaned);
    }
    return items;
  }, []);
};

const normalizeProfileInput = (body) => {
  const fields = new Set(["displayName", "jobTitle", "bio", "expertise", "topics", "targetAudience", "languages"]);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw profileError("Profile input must be an object.");
  if (Object.keys(body).some((field) => !fields.has(field))) throw profileError("Profile input contains unexpected fields.");
  const limits = { displayName: 200, jobTitle: 200, bio: 5000, targetAudience: 3000 };
  const result = {};
  Object.entries(limits).forEach(([field, limit]) => {
    if (body[field] !== undefined && typeof body[field] !== "string") throw profileError(`${field} must be text.`);
    const value = String(body[field] || "").trim();
    if (value.length > limit) throw profileError(`${field} is too long.`);
    result[field] = value;
  });
  result.expertise = normalizeList(body.expertise, "expertise");
  result.topics = normalizeList(body.topics, "topics");
  result.languages = normalizeList(body.languages, "languages", 15);
  return result;
};

const getProfileFilter = (req) => ({ companyId: req.company._id, userId: req.userId });

export const getDigitalCloneProfile = async (req, res, next) => {
  try {
    const profile = await DigitalCloneProfile.findOne(getProfileFilter(req)).lean();
    return res.json({ success: true, data: profile || null });
  } catch (error) {
    return next(error);
  }
};

export const saveDigitalCloneProfile = async (req, res, next) => {
  try {
    const input = normalizeProfileInput(req.body);
    const profile = await DigitalCloneProfile.findOneAndUpdate(
      getProfileFilter(req),
      {
        $set: {
          ...input,
        },
        $setOnInsert: { companyId: req.company._id, userId: req.userId },
      },
      { upsert: true, new: true, runValidators: true },
    );
    return res.json({ success: true, data: profile });
  } catch (error) {
    return next(error);
  }
};

export const acceptDigitalCloneConsent = async (req, res, next) => {
  try {
    const required = [
      "identityConfirmed",
      "voiceRightsConfirmed",
      "mediaRightsConfirmed",
      "aiRepresentationConsent",
    ];
    const missing = required.filter((field) => req.body[field] !== true);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        code: "DIGITAL_CLONE_CONSENT_REQUIRED",
        message: "All Digital Clone consent confirmations are required before setup can continue.",
      });
    }

    const acceptedAt = new Date();
    const profile = await DigitalCloneProfile.findOneAndUpdate(
      getProfileFilter(req),
      {
        $set: {
          status: "consented",
          consent: {
            identityConfirmed: true,
            voiceRightsConfirmed: true,
            mediaRightsConfirmed: true,
            aiRepresentationConsent: true,
            version: "1.0",
            acceptedAt,
            acceptedIp: String(req.ip || "").slice(0, 200),
          },
        },
        $setOnInsert: { companyId: req.company._id, userId: req.userId },
      },
      { upsert: true, new: true, runValidators: true },
    );

    return res.json({ success: true, data: profile });
  } catch (error) {
    return next(error);
  }
};

export const getDigitalBrainProfile = async (req, res, next) => {
  try {
    const data = await getDigitalBrain(getProfileFilter(req));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const saveDigitalBrainProfile = async (req, res, next) => {
  try {
    const data = await saveDigitalBrain({ ...getProfileFilter(req), body: req.body });
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getDigitalBrainReadiness = async (req, res, next) => {
  try {
    const { readiness } = await getDigitalBrain(getProfileFilter(req));
    return res.json({ success: true, data: readiness });
  } catch (error) {
    return next(error);
  }
};

export const generateDigitalCloneContent = async (req, res, next) => {
  try {
    const draft = await generateDigitalCloneDraft({ company: req.company, userId: req.userId, body: req.body });
    return res.status(201).json({ success: true, data: serializeGeneration(draft) });
  } catch (error) { return next(error); }
};

export const listDigitalCloneGenerations = async (req, res, next) => {
  try {
    const drafts = await listDigitalCloneDrafts(getProfileFilter(req));
    return res.json({ success: true, data: drafts.map(serializeGeneration) });
  } catch (error) { return next(error); }
};

export const getDigitalCloneGeneration = async (req, res, next) => {
  try {
    const draft = await getDigitalCloneDraft({ ...getProfileFilter(req), draftId: req.params.draftId });
    return res.json({ success: true, data: serializeGeneration(draft) });
  } catch (error) { return next(error); }
};

export const updateDigitalCloneGeneration = async (req, res, next) => {
  try {
    const draft = await editDigitalCloneDraft({ ...getProfileFilter(req), draftId: req.params.draftId, body: req.body });
    return res.json({ success: true, data: serializeGeneration(draft) });
  } catch (error) { return next(error); }
};

export const approveDigitalCloneGeneration = async (req, res, next) => {
  try {
    const draft = await approveDigitalCloneDraft({ ...getProfileFilter(req), draftId: req.params.draftId });
    return res.json({ success: true, data: serializeGeneration(draft) });
  } catch (error) { return next(error); }
};

const changeGenerationStatus = (status) => async (req, res, next) => {
  try {
    const draft = await setDigitalCloneDraftStatus({ ...getProfileFilter(req), draftId: req.params.draftId, status });
    return res.json({ success: true, data: serializeGeneration(draft) });
  } catch (error) { return next(error); }
};

export const rejectDigitalCloneGeneration = changeGenerationStatus("rejected");
export const archiveDigitalCloneGeneration = changeGenerationStatus("archived");

export const uploadDigitalCloneIdentityImages = async (req, res, next) => {
  try {
    const assets = await uploadIdentityAssets({ ...getProfileFilter(req), files: req.files || [] });
    return res.status(201).json({
      success: true,
      data: assets.map(serializeIdentityAsset),
    });
  } catch (error) {
    return next(error);
  }
};

export const listDigitalCloneIdentityImages = async (req, res, next) => {
  try {
    const assets = await listIdentityAssets(getProfileFilter(req));
    return res.json({ success: true, data: assets.map(serializeIdentityAsset) });
  } catch (error) {
    return next(error);
  }
};

export const deliverDigitalCloneIdentityImage = async (req, res, next) => {
  try {
    const { asset, stream } = await getIdentityAssetDeliveryStream({
      ...getProfileFilter(req),
      assetId: req.params.assetId,
    });
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Type", asset.mimeType || "image/webp");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (error) {
    return next(error);
  }
};

export const updateDigitalCloneIdentityImage = async (req, res, next) => {
  try {
    const asset = await updateIdentityAsset({
      ...getProfileFilter(req),
      assetId: req.params.assetId,
      body: req.body,
    });
    return res.json({ success: true, data: serializeIdentityAsset(asset) });
  } catch (error) {
    return next(error);
  }
};

export const revokeDigitalCloneIdentityImage = async (req, res, next) => {
  try {
    const asset = await revokeIdentityAsset({ ...getProfileFilter(req), assetId: req.params.assetId });
    return res.json({ success: true, data: serializeIdentityAsset(asset) });
  } catch (error) {
    return next(error);
  }
};

export const deleteDigitalCloneIdentityImage = async (req, res, next) => {
  try {
    const asset = await deleteIdentityAsset({ ...getProfileFilter(req), assetId: req.params.assetId });
    return res.json({ success: true, data: serializeIdentityAsset(asset) });
  } catch (error) {
    return next(error);
  }
};
