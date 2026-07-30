import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Company from "../models/company.js";
import ContentStudioContent from "../models/contentStudioContent.js";
import ContentStudioImageAsset from "../models/contentStudioImageAsset.js";
import ContentStudioImageAudit from "../models/contentStudioImageAudit.js";
import {
  findCompanyImageOrThrow,
} from "../services/contentStudio/imageOwnershipService.js";
import {
  deleteContent,
  saveContent,
  updateContent,
} from "../services/contentStudio/saveContentService.js";

let replSet;
let companyA;
let companyB;
let userId;
let assetA;
let assetB;

const contentInput = (companyId, assetId) => ({
  companyId,
  userId,
  title: "Tenant-safe article",
  content: "Article body",
  contentType: "blog",
  images: [{
    assetId,
    position: "manual",
    order: 0,
    altText: "Test image",
  }],
});

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri());
  userId = new mongoose.Types.ObjectId();
  companyA = await Company.create({
    name: "Company A",
    slug: "company-a",
    ownerUserId: userId,
  });
  companyB = await Company.create({
    name: "Company B",
    slug: "company-b",
    ownerUserId: userId,
  });
  assetA = await ContentStudioImageAsset.create({
    companyId: companyA._id,
    createdByUserId: userId,
    source: "local",
    provider: "cloudinary",
    filename: "a.webp",
    mimeType: "image/webp",
    url: "https://example.test/a.webp",
    storagePublicId: "company-a/a",
  });
  assetB = await ContentStudioImageAsset.create({
    companyId: companyB._id,
    createdByUserId: userId,
    source: "local",
    provider: "cloudinary",
    filename: "b.webp",
    mimeType: "image/webp",
    url: "https://example.test/b.webp",
    storagePublicId: "company-b/b",
  });
});

test.after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

test("returns generic IMAGE_NOT_FOUND and securely audits cross-company access", async () => {
  await assert.rejects(
    findCompanyImageOrThrow({
      companyId: companyA._id,
      assetId: assetB._id,
      userId,
      action: "attach",
    }),
    (error) =>
      error.code === "IMAGE_NOT_FOUND" &&
      error.message === "Image asset not found." &&
      error.statusCode === 404,
  );

  const audit = await ContentStudioImageAudit.findOne({
    companyId: companyA._id,
    imageId: assetB._id,
    eventType: "image.access_denied",
  }).lean();

  assert.ok(audit);
  assert.equal(audit.secureMetadata.owningCompanyId, String(companyB._id));
});

test("blocks cross-company image attachment without creating an article", async () => {
  await assert.rejects(
    saveContent(contentInput(companyA._id, assetB._id)),
    (error) => error.code === "IMAGE_NOT_FOUND",
  );
  assert.equal(await ContentStudioContent.countDocuments(), 0);
});

test("tracks image references across save, update, and delete", async () => {
  const article = await saveContent(contentInput(companyA._id, assetA._id));

  let refreshed = await ContentStudioImageAsset.findById(assetA._id).lean();
  assert.equal(refreshed.referenceCount, 1);

  await updateContent({
    companyId: companyA._id,
    userId,
    contentId: article._id,
    updates: { images: [] },
  });
  refreshed = await ContentStudioImageAsset.findById(assetA._id).lean();
  assert.equal(refreshed.referenceCount, 0);

  const reattached = await updateContent({
    companyId: companyA._id,
    userId,
    contentId: article._id,
    updates: contentInput(companyA._id, assetA._id),
  });
  assert.equal(reattached.images.length, 1);

  await deleteContent({
    companyId: companyA._id,
    contentId: article._id,
  });
  refreshed = await ContentStudioImageAsset.findById(assetA._id).lean();
  assert.equal(refreshed.referenceCount, 0);
});
