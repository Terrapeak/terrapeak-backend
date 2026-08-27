import DigitalCloneBrainProfile from "../models/digitalCloneBrainProfile.js";

const ALLOWED_FIELDS = new Set([
  "expertiseSummary", "expertiseAreas", "industries", "markets", "traits",
  "formality", "detailLevel", "energy", "storytelling", "technicality",
  "communicationDescription", "speakingPace", "preferredPhrases",
  "avoidedPhrases", "writingRules", "viewpoints", "stories", "avoidTopics",
  "prohibitedClaims", "additionalInstructions",
]);
const SCALE_FIELDS = ["formality", "detailLevel", "energy", "storytelling", "technicality"];
const LIST_FIELDS = [
  "expertiseAreas", "industries", "markets", "traits", "preferredPhrases",
  "avoidedPhrases", "writingRules", "avoidTopics", "prohibitedClaims",
];
const STRING_LIMITS = {
  expertiseSummary: 5000,
  communicationDescription: 5000,
  additionalInstructions: 5000,
};
const PACE_VALUES = new Set(["", "slow", "moderate", "fast"]);

const validationError = (message, code = "DIGITAL_BRAIN_INVALID") => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
};

const cleanString = (value, field, maxLength) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw validationError(`${field} must be text.`);
  const cleaned = value.trim();
  if (cleaned.length > maxLength) throw validationError(`${field} is too long.`);
  return cleaned;
};

const cleanList = (value, field, { maxItems = 30, maxLength = 300 } = {}) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw validationError(`${field} must be an array.`);
  if (value.length > maxItems) throw validationError(`${field} can contain at most ${maxItems} items.`);
  const seen = new Set();
  return value.reduce((items, item) => {
    if (typeof item !== "string") throw validationError(`${field} entries must be text.`);
    const cleaned = item.trim();
    if (!cleaned) return items;
    if (cleaned.length > maxLength) throw validationError(`${field} entries are too long.`);
    const key = cleaned.toLocaleLowerCase("en");
    if (!seen.has(key)) {
      seen.add(key);
      items.push(cleaned);
    }
    return items;
  }, []);
};

const cleanViewpoints = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) {
    throw validationError("viewpoints must be an array with at most 30 items.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw validationError(`viewpoints[${index}] is invalid.`);
    }
    const unexpected = Object.keys(item).filter((key) => !["topic", "position"].includes(key));
    if (unexpected.length) throw validationError(`viewpoints[${index}] contains unexpected fields.`);
    const topic = cleanString(item.topic, `viewpoints[${index}].topic`, 200);
    const position = cleanString(item.position, `viewpoints[${index}].position`, 2000);
    if (!topic || !position) throw validationError("Every viewpoint requires a topic and position.");
    return { topic, position };
  });
};

const cleanStories = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) {
    throw validationError("stories must be an array with at most 30 items.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw validationError(`stories[${index}] is invalid.`);
    }
    const unexpected = Object.keys(item).filter((key) => !["title", "summary", "tags"].includes(key));
    if (unexpected.length) throw validationError(`stories[${index}] contains unexpected fields.`);
    const title = cleanString(item.title, `stories[${index}].title`, 200);
    const summary = cleanString(item.summary, `stories[${index}].summary`, 3000);
    const tags = cleanList(item.tags ?? [], `stories[${index}].tags`, { maxItems: 15, maxLength: 100 });
    if (!title || !summary) throw validationError("Every story requires a title and summary.");
    return { title, summary, tags };
  });
};

export const normalizeDigitalBrainInput = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("Digital Brain input must be an object.");
  }
  const unexpected = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length) {
    throw validationError(`Unexpected Digital Brain fields: ${unexpected.join(", ")}.`);
  }

  const update = {};
  Object.entries(STRING_LIMITS).forEach(([field, maxLength]) => {
    const value = cleanString(body[field], field, maxLength);
    if (value !== undefined) update[field] = value;
  });
  LIST_FIELDS.forEach((field) => {
    const value = cleanList(body[field], field);
    if (value !== undefined) update[field] = value;
  });
  SCALE_FIELDS.forEach((field) => {
    if (body[field] === undefined) return;
    if (body[field] === null || body[field] === "") {
      update[field] = null;
      return;
    }
    if (!Number.isInteger(body[field]) || body[field] < 1 || body[field] > 5) {
      throw validationError(`${field} must be a whole number from 1 to 5.`);
    }
    update[field] = body[field];
  });
  if (body.speakingPace !== undefined) {
    const pace = cleanString(body.speakingPace, "speakingPace", 20);
    if (!PACE_VALUES.has(pace)) throw validationError("speakingPace must be slow, moderate, or fast.");
    update.speakingPace = pace;
  }
  const viewpoints = cleanViewpoints(body.viewpoints);
  if (viewpoints !== undefined) update.viewpoints = viewpoints;
  const stories = cleanStories(body.stories);
  if (stories !== undefined) update.stories = stories;
  return update;
};

export const calculateDigitalBrainReadiness = (profile = {}) => {
  const checks = [
    { id: "expertise", complete: Boolean(profile.expertiseSummary?.trim() || profile.expertiseAreas?.length) },
    { id: "personality", complete: Boolean(profile.traits?.length) && SCALE_FIELDS.every((field) => Number.isInteger(profile[field])) },
    { id: "communication", complete: Boolean(profile.communicationDescription?.trim() && profile.speakingPace && profile.writingRules?.length) },
    { id: "viewpoints", complete: Boolean(profile.viewpoints?.length) },
    { id: "stories", complete: Boolean(profile.stories?.length) },
    { id: "guardrails", complete: Boolean(profile.avoidTopics?.length || profile.prohibitedClaims?.length || profile.additionalInstructions?.trim()) },
  ];
  const completedSections = checks.filter((check) => check.complete).length;
  return {
    completion: Math.round((completedSections / checks.length) * 100),
    ready: completedSections === checks.length,
    sections: checks,
  };
};

export const getDigitalBrain = async ({ companyId, userId }) => {
  const profile = await DigitalCloneBrainProfile.findOne({ companyId, userId }).lean();
  return { profile, readiness: calculateDigitalBrainReadiness(profile || {}) };
};

export const saveDigitalBrain = async ({ companyId, userId, body }) => {
  const update = normalizeDigitalBrainInput(body);
  await DigitalCloneBrainProfile.findOneAndUpdate(
    { companyId, userId },
    {
      $set: update,
      $setOnInsert: { companyId, userId },
    },
    { upsert: true, new: true, runValidators: true },
  );
  let profile = await DigitalCloneBrainProfile.findOne({ companyId, userId }).lean();
  const readiness = calculateDigitalBrainReadiness(profile);
  const status = readiness.ready ? "ready" : "draft";
  if (profile.status !== status) {
    profile = await DigitalCloneBrainProfile.findOneAndUpdate(
      { _id: profile._id, companyId, userId },
      { $set: { status } },
      { new: true, runValidators: true },
    ).lean();
  }
  return { profile, readiness: calculateDigitalBrainReadiness(profile) };
};
