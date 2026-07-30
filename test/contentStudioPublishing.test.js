import test from "node:test";
import assert from "node:assert/strict";
import { buildPublishedContent } from "../services/contentStudio/publishContentService.js";

test("buildPublishedContent replaces stable asset references with public URLs", () => {
  const id = "64a4f3fb6af436f4d8dbdd88";
  const result = buildPublishedContent({
    content: `Before\n\n![Example](asset:${id})\n\nAfter`,
    assets: [{
      _id: id,
      publishedUrl: "https://res.cloudinary.com/demo/image/upload/example.webp",
    }],
  });
  assert.equal(
    result,
    "Before\n\n![Example](https://res.cloudinary.com/demo/image/upload/example.webp)\n\nAfter",
  );
});

test("buildPublishedContent refuses an unpublished image", () => {
  assert.throws(
    () => buildPublishedContent({
      content: "![Example](asset:64a4f3fb6af436f4d8dbdd88)",
      assets: [{ _id: "64a4f3fb6af436f4d8dbdd88", publishedUrl: "" }],
    }),
    (error) => error.code === "PUBLIC_RENDITION_MISSING",
  );
});
