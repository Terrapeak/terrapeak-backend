import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContentPrompt,
  CONTENT_STUDIO_SYSTEM_INSTRUCTION,
} from "../services/contentStudio/promptBuilder.js";

test("Content Studio keeps system rules separate from user context", () => {
  assert.match(CONTENT_STUDIO_SYSTEM_INSTRUCTION, /Return valid JSON only/);

  const prompt = buildContentPrompt({
    brief: {
      contentType: "blog",
      topic: "Customer retention",
      goal: "education",
      audience: "Small business owners",
      tone: "professional",
      length: "medium",
      keyPoints: ["Repeat training", "Use practical scenarios"],
      keywords: ["retention"],
    },
  });

  assert.match(prompt, /- Repeat training/);
  assert.match(prompt, /- Use practical scenarios/);
  assert.doesNotMatch(prompt, /^You are an expert marketing content writer\./);
});
