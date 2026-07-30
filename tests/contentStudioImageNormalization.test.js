import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeContentStudioImage } from "../services/contentStudio/imageNormalizationService.js";

test("normalizes a genuine PNG to metadata-free WebP", async () => {
  const input = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#24517a" },
  }).png().withMetadata({ orientation: 6 }).toBuffer();

  const result = await normalizeContentStudioImage({
    buffer: input,
    filename: "sample.png",
    declaredMimeType: "image/png",
  });
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.filename, "sample.webp");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
});

test("rejects a declared type that does not match the signature", async () => {
  const input = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  }).jpeg().toBuffer();

  await assert.rejects(
    normalizeContentStudioImage({
      buffer: input,
      filename: "fake.png",
      declaredMimeType: "image/png",
    }),
    (error) => error.code === "IMAGE_TYPE_MISMATCH",
  );
});

test("rejects unsupported signatures before decoding", async () => {
  await assert.rejects(
    normalizeContentStudioImage({
      buffer: Buffer.from("<svg></svg>"),
      filename: "unsafe.svg",
      declaredMimeType: "image/svg+xml",
    }),
    (error) => error.code === "IMAGE_SIGNATURE_INVALID",
  );
});
