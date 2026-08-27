import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryServer } from "mongodb-memory-server";
import DigitalCloneVisualAsset from "../models/digitalCloneVisualAsset.js";
import {
  acceptDigitalCloneConsent,
  saveDigitalCloneProfile,
} from "../controllers/digitalCloneController.js";
import { getDigitalBrain, saveDigitalBrain } from "../services/digitalCloneBrainService.js";
import {
  deleteIdentityAsset,
  getApprovedIdentityAssetsForProvider,
  listIdentityAssets,
  revokeIdentityAsset,
  updateIdentityAsset,
  uploadIdentityAssets,
} from "../services/digitalCloneVisualIdentityService.js";

const invokeController = (handler, req) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ statusCode: this.statusCode, payload }); return this; },
  };
  handler(req, res, reject);
});

test("local Digital Clone profile-to-deletion happy path uses no production resources", async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  try {
    const companyId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const reqContext = { company: { _id: companyId }, userId, ip: "127.0.0.1" };

    const profile = await invokeController(saveDigitalCloneProfile, {
      ...reqContext,
      body: {
        displayName: "Test Creator",
        jobTitle: "Founder",
        bio: "Builds practical systems.",
        expertise: ["Operations"],
        topics: ["Practical AI"],
        targetAudience: "SME leaders",
        languages: ["English"],
      },
    });
    assert.equal(profile.payload.data.displayName, "Test Creator");

    const consent = await invokeController(acceptDigitalCloneConsent, {
      ...reqContext,
      body: {
        identityConfirmed: true,
        voiceRightsConfirmed: true,
        mediaRightsConfirmed: true,
        aiRepresentationConsent: true,
      },
    });
    assert.equal(consent.payload.data.status, "consented");

    const brainInput = {
      expertiseSummary: "Practical operations and AI adoption.",
      expertiseAreas: ["Operations"], industries: ["Technology"], markets: ["Singapore"],
      traits: ["Practical"], formality: 3, detailLevel: 4, energy: 3, storytelling: 3, technicality: 3,
      communicationDescription: "Direct and example-led.", speakingPace: "moderate",
      preferredPhrases: ["Start with the practical problem."], avoidedPhrases: ["Synergy"],
      writingRules: ["Use short paragraphs"],
      viewpoints: [{ topic: "AI adoption", position: "Start with one practical use case." }],
      stories: [{ title: "First workflow", summary: "A small workflow saved a team time.", tags: ["SME"] }],
      avoidTopics: ["Unverified claims"], prohibitedClaims: ["Guaranteed outcomes"],
      additionalInstructions: "Keep a human approval step.",
    };
    const savedBrain = await saveDigitalBrain({ companyId, userId, body: brainInput });
    assert.equal(savedBrain.readiness.ready, true);
    assert.equal((await getDigitalBrain({ companyId, userId })).readiness.completion, 100);

    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "white" } }).png().toBuffer();
    let storageSequence = 0;
    const uploaded = await uploadIdentityAssets({
      companyId,
      userId,
      files: [
        { buffer: png, originalname: "primary.png", mimetype: "image/png" },
        { buffer: png, originalname: "look.png", mimetype: "image/png" },
      ],
      uploadBuffer: async ({ buffer }) => ({
        public_id: `mock/private/${++storageSequence}`,
        width: 24,
        height: 24,
        bytes: buffer.length,
      }),
    });
    assert.equal(uploaded.length, 2);
    assert.ok(uploaded.every((asset) => asset.approvedForCloneUse === false));
    assert.equal((await listIdentityAssets({ companyId, userId })).length, 2);

    await updateIdentityAsset({
      companyId, userId, assetId: uploaded[0]._id,
      body: { role: "primary", lookName: "Primary portrait", notes: "Approved", approvedForCloneUse: true },
    });
    await updateIdentityAsset({
      companyId, userId, assetId: uploaded[1]._id,
      body: { role: "look-reference", lookName: "Professional", approvedForCloneUse: true },
    });
    assert.equal((await getApprovedIdentityAssetsForProvider({ companyId, userId })).length, 2);

    await revokeIdentityAsset({ companyId, userId, assetId: uploaded[0]._id });
    const providerAssets = await getApprovedIdentityAssetsForProvider({ companyId, userId });
    assert.deepEqual(providerAssets.map((asset) => String(asset._id)), [String(uploaded[1]._id)]);

    await deleteIdentityAsset({
      companyId, userId, assetId: uploaded[0]._id,
      destroyAsset: async (publicId) => assert.equal(publicId, "mock/private/1"),
    });
    const deleted = await DigitalCloneVisualAsset.findOne({
      _id: uploaded[0]._id,
      companyId,
      userId,
    }).lean();
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.approvedForCloneUse, false);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
