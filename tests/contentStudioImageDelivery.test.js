import test from "node:test";
import assert from "node:assert/strict";
import { serializeImageAssetForClient } from "../services/contentStudio/imageDeliveryService.js";

test("legacy public assets remain compatible without exposing storage identifiers", () => {
  const result = serializeImageAssetForClient({
    req: {},
    asset: {
      _id: "asset-1",
      url: "https://res.cloudinary.com/demo/image/upload/example.webp",
      storagePublicId: "private/internal-id",
      filename: "example.webp",
    },
  });
  assert.equal(result.visibility, "legacy-public");
  assert.equal(result.deliveryType, "upload");
  assert.equal(result.url, "https://res.cloudinary.com/demo/image/upload/example.webp");
  assert.equal(result.storagePublicId, undefined);
});
