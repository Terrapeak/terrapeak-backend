import DigitalCloneProfile from "../models/digitalCloneProfile.js";

const normalizeList = (value, limit = 30) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
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
    const profile = await DigitalCloneProfile.findOneAndUpdate(
      getProfileFilter(req),
      {
        $set: {
          displayName: String(req.body.displayName || "").trim(),
          jobTitle: String(req.body.jobTitle || "").trim(),
          bio: String(req.body.bio || "").trim(),
          expertise: normalizeList(req.body.expertise),
          topics: normalizeList(req.body.topics),
          targetAudience: String(req.body.targetAudience || "").trim(),
          languages: normalizeList(req.body.languages, 15),
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
