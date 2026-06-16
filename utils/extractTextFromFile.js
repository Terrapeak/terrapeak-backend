import fs from "fs";

import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const extractTextFromFile = async (file) => {
  try {
    const { mimetype, path } = file;

    // TXT
    if (mimetype === "text/plain") {
      return fs.readFileSync(path, "utf-8");
    }

    // PDF
    if (mimetype === "application/pdf") {
      const buffer = fs.readFileSync(path);
      const parser = new PDFParse({data:buffer});
      const result = await parser.getText();
      return result.text;
    }

    // DOCX
    if (
      mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ path });
      return result.value;
    }

    // Unsupported
    throw new Error("Unsupported file type. Use PDF, TXT, or DOCX.");
  } catch (err) {
    console.log(err);
    throw new Error("Failed to extract text: " + err.message);
  }
};
