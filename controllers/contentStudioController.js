import asyncHandler from "express-async-handler";

import { generateContent } from "../services/contentStudio/generateContentService.js";

const ALLOWED_CONTENT_TYPES = new Set([
  "blog",
  "social-post",
  "email",
  "newsletter",
  "website-copy",
  "product-description",
]);

const ALLOWED_GOALS = new Set([
  "awareness",
  "engagement",
  "leads",
  "sales",
  "education",
  "retention",
]);

const ALLOWED_TONES = new Set([
  "professional",
  "friendly",
  "confident",
  "informative",
  "persuasive",
  "conversational",
]);

const ALLOWED_LENGTHS = new Set(["short", "medium", "long"]);

const textValue = (value, maximumLength) =>
  String(value || "").trim().slice(0, maximumLength);

const textList = (value, maximumItems, maximumItemLength) => {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n|,/));

  return items
    .map((item) => textValue(item, maximumItemLength))
    .filter(Boolean)
    .slice(0, maximumItems);
};

const validateBrief = (body = {}) => {
  const errors = {};

  if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
    errors.contentType = "Select a valid content type.";
  }

  if (!ALLOWED_GOALS.has(body.goal)) {
    errors.goal = "Select a valid business goal.";
  }

  if (!textValue(body.topic, 1000)) {
    errors.topic = "Enter the content topic.";
  }

  if (!textValue(body.audience, 1000)) {
    errors.audience = "Enter the target audience.";
  }

  if (!ALLOWED_TONES.has(body.tone)) {
    errors.tone = "Select a valid tone.";
  }

  if (!ALLOWED_LENGTHS.has(body.length)) {
    errors.length = "Select a valid content length.";
  }

  return errors;
};

const normalizeBrief = (body) => ({
  contentType: body.contentType,
  goal: body.goal,
  topic: textValue(body.topic, 1000),
  audience: textValue(body.audience, 1000),
  tone: body.tone,
  length: body.length,
  keyPoints: textList(body.keyPoints, 50, 500),
  keywords: textList(body.keywords, 30, 100),
  callToAction: textValue(body.callToAction, 1000),
});

export const generateContentDraft = asyncHandler(async (req, res) => {
  const validationErrors = validateBrief(req.body);

  if (Object.keys(validationErrors).length > 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CONTENT_BRIEF",
      message: "Review the highlighted content brief fields.",
      errors: validationErrors,
    });
  }

  const generated = await generateContent({
    company: req.company,
    userId: req.userId,
    brief: normalizeBrief(req.body),
  });

  return res.status(201).json({
    success: true,
    message: "Content generated successfully.",
    data: generated,
  });
});