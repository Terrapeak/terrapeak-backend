import fs from "fs/promises";

import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const MAX_EXTRACTED_CHARACTERS = 500000;
const EXTRACTION_TIMEOUT_MS = 15000;

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const error = new Error("File extraction timed out.");
      const timeout = setTimeout(() => reject(error), timeoutMs);
      timeout.unref?.();
    }),
  ]);

const limitExtractedText = (text) => {
  const value = String(text || "");

  if (value.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error("Extracted instruction text is too large.");
  }

  return value;
};

export const extractTextFromFile = async (file) => {
  try {
    const { mimetype, path } = file;

    let extraction;

    if (mimetype === "text/plain") {
      extraction = fs.readFile(path, "utf-8");
    } else if (mimetype === "application/pdf") {
      extraction = fs.readFile(path).then(async (buffer) => {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        return result.text;
      });
    } else if (
      mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      extraction = mammoth.extractRawText({ path }).then((result) => result.value);
    } else {
      throw new Error("Unsupported file type. Use PDF, TXT, or DOCX.");
    }

    const text = await withTimeout(extraction, EXTRACTION_TIMEOUT_MS);
    return limitExtractedText(text);
  } catch (error) {
    throw new Error(`Failed to extract text: ${error.message}`);
  }
};
