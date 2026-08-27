import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import sharp from "sharp";
import { Readable } from "node:stream";
import { MongoMemoryServer } from "mongodb-memory-server";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneVisualAsset from "../models/digitalCloneVisualAsset.js";
import {
  assertDigitalCloneMediaConsent,
  deleteIdentityAsset,
  getApprovedIdentityAssetsForProvider,
  getIdentityAssetDeliveryStream,
  listIdentityAssets,
  revokeIdentityAsset,
  serializeIdentityAsset,
  updateIdentityAsset,
  uploadIdentityAssets,
} from "../services/digitalCloneVisualIdentityService.js";

let mongo;
let companyA;
let companyB;
let userA;
let userB;

const consent = {
  identityConfirmed: true,
  mediaRightsConfirmed: true,
  aiRepresentationConsent: true,
  acceptedAt: new Date(),
};

const makeAsset = (overrides = {}) => DigitalCloneVisualAsset.create({
  companyId: companyA,
  userId: userA,
  filename: "reference.webp",
  mimeType: "image/webp",
  storagePublicId: `identity/${new mongoose.Types.ObjectId()}`,
  ...overrides,
});

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  companyA = new mongoose.Types.ObjectId();
  companyB = new mongoose.Types.ObjectId();
  userA = new mongoose.Types.ObjectId();
  userB = new mongoose.Types.ObjectId();
  await DigitalCloneProfile.create({ companyId: companyA, userId: userA, status: "consented", consent });
  await DigitalCloneVisualAsset.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("identity media requires the existing consent state", async () => {
  await assert.doesNotReject(assertDigitalCloneMediaConsent({ companyId: companyA, userId: userA }));
  await assert.rejects(
    assertDigitalCloneMediaConsent({ companyId: companyB, userId: userA }),
    (error) => error.code === "DIGITAL_CLONE_MEDIA_CONSENT_REQUIRED",
  );

  await DigitalCloneProfile.create({
    companyId: companyB,
    userId: userB,
    status: "consented",
    consent: { ...consent, acceptedAt: null },
  });
  await assert.rejects(
    assertDigitalCloneMediaConsent({ companyId: companyB, userId: userB }),
    (error) => error.code === "DIGITAL_CLONE_MEDIA_CONSENT_REQUIRED",
  );
});

test("only one active primary survives repeated or concurrent updates", async () => {
  const first = await makeAsset();
  const second = await makeAsset();
  await updateIdentityAsset({
    companyId: companyA,
    userId: userA,
    assetId: first._id,
    body: { role: "primary" },
  });
  await Promise.allSettled([
    updateIdentityAsset({ companyId: companyA, userId: userA, assetId: first._id, body: { role: "primary" } }),
    updateIdentityAsset({ companyId: companyA, userId: userA, assetId: second._id, body: { role: "primary" } }),
  ]);
  const primaries = await DigitalCloneVisualAsset.find({
    companyId: companyA,
    userId: userA,
    status: "active",
    role: "primary",
  });
  assert.equal(primaries.length, 1);
});

test("upload normalizes valid images and rejects unsupported content", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const uploaded = await uploadIdentityAssets({
    companyId: companyA,
    userId: userA,
    files: [{ buffer: png, originalname: "portrait.png", mimetype: "image/png" }],
    uploadBuffer: async ({ buffer }) => ({
      public_id: `identity/${new mongoose.Types.ObjectId()}`,
      width: 20,
      height: 20,
      bytes: buffer.length,
    }),
  });
  assert.equal(uploaded[0].mimeType, "image/webp");
  assert.equal(uploaded[0].approvedForCloneUse, false);

  await assert.rejects(
    uploadIdentityAssets({
      companyId: companyB,
      userId: userB,
      files: [{ buffer: Buffer.from("not-an-image"), originalname: "fake.jpg", mimetype: "image/jpeg" }],
      uploadBuffer: async () => assert.fail("invalid images must not reach storage"),
    }),
    (error) => error.code === "IMAGE_SIGNATURE_INVALID",
  );

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  oversized[2] = 0xff;
  await assert.rejects(
    uploadIdentityAssets({
      companyId: companyB,
      userId: userB,
      files: [{ buffer: oversized, originalname: "oversized.jpg", mimetype: "image/jpeg" }],
      uploadBuffer: async () => assert.fail("oversized images must not reach storage"),
    }),
    (error) => error.code === "IMAGE_TOO_LARGE",
  );

  await assert.rejects(
    uploadIdentityAssets({
      companyId: companyB,
      userId: userB,
      files: Array.from({ length: 11 }, () => ({ buffer: png, originalname: "portrait.png", mimetype: "image/png" })),
      uploadBuffer: async () => assert.fail("over-count uploads must not reach storage"),
    }),
    (error) => error.code === "IDENTITY_UPLOAD_LIMIT",
  );
});

test("list and metadata updates are scoped to company and user", async () => {
  const owned = await makeAsset();
  await makeAsset({ userId: userB });
  await makeAsset({ companyId: companyB });
  const listed = await listIdentityAssets({ companyId: companyA, userId: userA });
  assert.ok(listed.every((asset) => asset.companyId.equals(companyA) && asset.userId.equals(userA)));

  await assert.rejects(
    updateIdentityAsset({ companyId: companyA, userId: userB, assetId: owned._id, body: { notes: "IDOR" } }),
    (error) => error.code === "IDENTITY_ASSET_NOT_FOUND",
  );
  await assert.rejects(
    revokeIdentityAsset({ companyId: companyB, userId: userA, assetId: owned._id }),
    (error) => error.code === "IDENTITY_ASSET_NOT_FOUND",
  );
  await assert.rejects(
    deleteIdentityAsset({
      companyId: companyA,
      userId: userB,
      assetId: owned._id,
      destroyAsset: async () => assert.fail("IDOR deletion must not reach storage"),
    }),
    (error) => error.code === "IDENTITY_ASSET_NOT_FOUND",
  );
  const updated = await updateIdentityAsset({
    companyId: companyA,
    userId: userA,
    assetId: owned._id,
    body: { role: "primary", lookName: "Professional", approvedForCloneUse: true },
  });
  assert.equal(updated.role, "primary");
  assert.equal(updated.approvedForCloneUse, true);
});

test("revoked and deleted references cannot pass the provider authorization gate", async () => {
  const revoked = await makeAsset({ approvedForCloneUse: true });
  await revokeIdentityAsset({ companyId: companyA, userId: userA, assetId: revoked._id });
  const refreshedRevoked = await DigitalCloneVisualAsset.findById(revoked._id).lean();
  assert.equal(refreshedRevoked.status, "revoked");
  assert.equal(refreshedRevoked.approvedForCloneUse, false);

  const deleted = await makeAsset({ approvedForCloneUse: true });
  await deleteIdentityAsset({
    companyId: companyA,
    userId: userA,
    assetId: deleted._id,
    destroyAsset: async () => ({ result: "ok" }),
  });
  const refreshedDeleted = await DigitalCloneVisualAsset.findById(deleted._id).lean();
  assert.equal(refreshedDeleted.status, "deleted");
  assert.equal(refreshedDeleted.approvedForCloneUse, false);

  const approved = await getApprovedIdentityAssetsForProvider({ companyId: companyA, userId: userA });
  assert.ok(approved.every((asset) => asset.status === "active" && asset.approvedForCloneUse));
  assert.ok(!approved.some((asset) => asset._id.equals(revoked._id) || asset._id.equals(deleted._id)));
});

test("storage deletion failure leaves the database asset active and approved", async () => {
  const asset = await makeAsset({ approvedForCloneUse: true });
  await assert.rejects(
    deleteIdentityAsset({
      companyId: companyA,
      userId: userA,
      assetId: asset._id,
      destroyAsset: async () => { throw new Error("simulated private storage failure"); },
    }),
    /simulated private storage failure/,
  );
  const unchanged = await DigitalCloneVisualAsset.findOne({
    _id: asset._id,
    companyId: companyA,
    userId: userA,
  }).lean();
  assert.equal(unchanged.status, "active");
  assert.equal(unchanged.approvedForCloneUse, true);
  assert.equal(unchanged.deletedAt, null);
});

test("serialization hides storage identifiers and never signs inactive assets", () => {
  const serialized = serializeIdentityAsset({
    _id: new mongoose.Types.ObjectId(),
    status: "revoked",
    storagePublicId: "private/internal-identity-id",
    filename: "revoked.webp",
  });
  assert.equal(serialized.storagePublicId, undefined);
  assert.equal(serialized.primaryScopeKey, undefined);
  assert.equal(serialized.url, undefined);
});

test("private delivery stays backend-mediated and refuses inactive assets before storage access", async () => {
  const priorEnvironment = {
    cloud: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "local-test-cloud";
  process.env.CLOUDINARY_API_KEY = "local-test-key";
  process.env.CLOUDINARY_API_SECRET = "local-test-secret";
  try {
    const active = await makeAsset();
    let requestedInternalUrl = "";
    const delivery = await getIdentityAssetDeliveryStream({
      companyId: companyA,
      userId: userA,
      assetId: active._id,
      fetchStream: async (url, options) => {
        requestedInternalUrl = url;
        assert.equal(options.responseType, "stream");
        assert.equal(options.maxRedirects, 0);
        return { data: Readable.from([Buffer.from("mock-image")]) };
      },
    });
    assert.ok(requestedInternalUrl.includes("/image/authenticated/"));
    assert.ok(!requestedInternalUrl.includes("local-test-key"));
    assert.ok(!requestedInternalUrl.includes("local-test-secret"));
    assert.equal(serializeIdentityAsset(active).url, undefined);
    assert.ok(delivery.stream);

    await revokeIdentityAsset({ companyId: companyA, userId: userA, assetId: active._id });
    await assert.rejects(
      getIdentityAssetDeliveryStream({
        companyId: companyA,
        userId: userA,
        assetId: active._id,
        fetchStream: async () => assert.fail("inactive assets must not reach private storage"),
      }),
      (error) => error.code === "IDENTITY_ASSET_NOT_FOUND",
    );
  } finally {
    if (priorEnvironment.cloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = priorEnvironment.cloud;
    if (priorEnvironment.key === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = priorEnvironment.key;
    if (priorEnvironment.secret === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = priorEnvironment.secret;
  }
});

test("the active reference limit is enforced before storage upload", async () => {
  await DigitalCloneVisualAsset.deleteMany({ companyId: companyB, userId: userB });
  await DigitalCloneVisualAsset.insertMany(Array.from({ length: 30 }, (_, index) => ({
    companyId: companyB,
    userId: userB,
    filename: `${index}.webp`,
    mimeType: "image/webp",
    storagePublicId: `limit/${index}`,
  })));
  await assert.rejects(
    uploadIdentityAssets({
      companyId: companyB,
      userId: userB,
      files: [{ buffer: Buffer.from("unused"), originalname: "extra.png", mimetype: "image/png" }],
      uploadBuffer: async () => assert.fail("limit rejection must happen before storage upload"),
    }),
    (error) => error.code === "IDENTITY_ACTIVE_LIMIT",
  );
});
