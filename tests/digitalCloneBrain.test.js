import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDigitalBrainReadiness,
  normalizeDigitalBrainInput,
} from "../services/digitalCloneBrainService.js";

const readyProfile = {
  expertiseSummary: "I help SMEs adopt practical automation.",
  expertiseAreas: ["AI adoption"],
  traits: ["Practical", "Direct"],
  formality: 3,
  detailLevel: 4,
  energy: 3,
  storytelling: 4,
  technicality: 2,
  communicationDescription: "Clear, practical and grounded in examples.",
  speakingPace: "moderate",
  writingRules: ["Use short paragraphs"],
  viewpoints: [{ topic: "AI adoption", position: "Start with one practical use case." }],
  stories: [{ title: "First automation", summary: "A measured rollout reduced admin work.", tags: ["SME"] }],
  avoidTopics: ["Unverified medical advice"],
};

test("Digital Brain normalization trims and deduplicates bounded lists", () => {
  const result = normalizeDigitalBrainInput({
    expertiseAreas: [" AI adoption ", "ai adoption", "Operations"],
    formality: 3,
    speakingPace: "moderate",
  });
  assert.deepEqual(result.expertiseAreas, ["AI adoption", "Operations"]);
  assert.equal(result.formality, 3);
});

test("Digital Brain validation rejects unexpected fields and invalid scales", () => {
  assert.throws(() => normalizeDigitalBrainInput({ userId: "other-user" }), /Unexpected Digital Brain fields/);
  assert.throws(() => normalizeDigitalBrainInput({ status: "ready" }), /Unexpected Digital Brain fields/);
  assert.throws(() => normalizeDigitalBrainInput({ energy: 6 }), /whole number from 1 to 5/);
  assert.throws(() => normalizeDigitalBrainInput({ speakingPace: "instant" }), /slow, moderate, or fast/);
});

test("Digital Brain validation rejects malformed positions and stories", () => {
  assert.throws(() => normalizeDigitalBrainInput({ viewpoints: [{ topic: "Missing position" }] }), /requires a topic and position/);
  assert.throws(() => normalizeDigitalBrainInput({ stories: [{ title: "Missing summary" }] }), /requires a title and summary/);
});

test("Digital Brain validation rejects oversized strings, arrays, entries, and nested tags", () => {
  assert.throws(() => normalizeDigitalBrainInput({ expertiseSummary: "x".repeat(5001) }), /too long/);
  assert.throws(() => normalizeDigitalBrainInput({ industries: Array.from({ length: 31 }, () => "Industry") }), /at most 30/);
  assert.throws(() => normalizeDigitalBrainInput({ markets: ["x".repeat(301)] }), /entries are too long/);
  assert.throws(
    () => normalizeDigitalBrainInput({
      stories: [{ title: "Story", summary: "Summary", tags: Array.from({ length: 16 }, () => "tag") }],
    }),
    /at most 15/,
  );
});

test("Digital Brain is only ready when all substantive sections are complete", () => {
  assert.deepEqual(calculateDigitalBrainReadiness({}).ready, false);
  const readiness = calculateDigitalBrainReadiness(readyProfile);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.completion, 100);
});
