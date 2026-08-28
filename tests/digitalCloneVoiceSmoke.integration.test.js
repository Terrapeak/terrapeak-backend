import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneVoice from "../models/digitalCloneVoice.js";
import DigitalCloneVoicePreview from "../models/digitalCloneVoicePreview.js";
import DigitalCloneVoiceSample from "../models/digitalCloneVoiceSample.js";
import { MockVoiceProvider } from "../providers/digitalCloneVoice/index.js";
import {
  acceptVoiceConsent,
  approveVoice,
  calculateVoiceReadiness,
  createVoiceClone,
  generateVoicePreview,
  getVoicePreviewDelivery,
  revokeVoice,
  uploadVoiceSamples,
} from "../services/digitalCloneVoiceService.js";

const wav = () => Buffer.from("524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex");
const authorization = {
  voiceOwnershipOrAuthorization: true,
  processingAuthorized: true,
  generatedSpeechAuthorized: true,
  revocationUnderstood: true,
};

test("local Voice Step 4 smoke flow uses only injected provider and storage", async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  try {
    const companyId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const provider = new MockVoiceProvider();
    const storage = new Map();

    const createProfile = (id) => DigitalCloneProfile.create({
      companyId,
      userId: id,
      displayName: "Authorized Person",
      bio: "A complete local test profile.",
      expertise: ["Testing"],
      status: "consented",
      consent: {
        identityConfirmed: true,
        voiceRightsConfirmed: true,
        mediaRightsConfirmed: true,
        aiRepresentationConsent: true,
        version: "1.0",
        acceptedAt: new Date(),
      },
    });
    await createProfile(userId);
    await createProfile(otherUserId);
    await acceptVoiceConsent({ companyId, userId, body: authorization });
    await acceptVoiceConsent({ companyId, userId: otherUserId, body: authorization });

    const [sample] = await uploadVoiceSamples({
      companyId,
      userId,
      files: [{ buffer: wav(), originalname: "authorized.wav", mimetype: "audio/wav" }],
      uploadAudio: async ({ buffer }) => {
        storage.set("sample-private", buffer);
        return { public_id: "sample-private", bytes: buffer.length };
      },
      destroyAudio: async (id) => storage.delete(id),
    });
    assert.equal(sample.status, "active");

    const voice = await createVoiceClone({
      companyId,
      userId,
      provider,
      readSample: async ({ storagePublicId }) => storage.get(storagePublicId),
    });
    assert.equal(voice.status, "ready");

    const preview = await generateVoicePreview({
      companyId,
      userId,
      body: { text: "Welcome to the local TerraPeak Voice smoke test." },
      provider,
      uploadAudio: async ({ buffer }) => {
        storage.set("preview-private", buffer);
        return { public_id: "preview-private", bytes: buffer.length };
      },
    });
    assert.equal(calculateVoiceReadiness(voice).ready, false);
    await assert.rejects(
      getVoicePreviewDelivery({ companyId, userId: otherUserId, previewId: preview._id }),
      (error) => error.code === "VOICE_PREVIEW_NOT_FOUND",
    );

    const approved = await approveVoice({ companyId, userId, previewId: preview._id });
    assert.equal(calculateVoiceReadiness(approved).ready, true);

    const revoked = await revokeVoice({ companyId, userId, provider });
    assert.equal(calculateVoiceReadiness(revoked).ready, false);
    await assert.rejects(
      generateVoicePreview({ companyId, userId, body: { text: "This must be blocked." }, provider }),
      (error) => error.code === "VOICE_CONSENT_REQUIRED",
    );
  } finally {
    await Promise.all([
      DigitalCloneProfile.deleteMany({}),
      DigitalCloneVoice.deleteMany({}),
      DigitalCloneVoiceSample.deleteMany({}),
      DigitalCloneVoicePreview.deleteMany({}),
    ]);
    await mongoose.disconnect();
    await mongo.stop();
  }
});
