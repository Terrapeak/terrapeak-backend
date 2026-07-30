import "dotenv/config";
import mongoose from "mongoose";
import Company from "../models/company.js";
import {
  decryptContentStudioCredential,
  encryptContentStudioCredential,
  fingerprintContentStudioCredential,
} from "../utils/contentStudioCredentialEncryption.js";

const mode = process.argv[2] || "audit";
const allowedModes = new Set(["audit", "apply", "verify", "rollback"]);

if (!allowedModes.has(mode)) {
  console.error("Usage: node scripts/migrateContentStudioAiKeys.js audit|apply|verify|rollback");
  process.exitCode = 1;
} else {
  const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const companies = await Company.find({
      $or: [
        { "contentStudioAiConfig.geminiKey": { $nin: ["", null] } },
        { "contentStudioAiConfig.imageGeminiKey": { $nin: ["", null] } },
        { "contentStudioAiConfig.credentialMigration.migrationId": "content-studio-ai-keys-v1" },
      ],
    });

    const summary = {
      mode,
      scanned: companies.length,
      candidates: 0,
      migrated: 0,
      verified: 0,
      rolledBack: 0,
      failed: [],
    };

    for (const company of companies) {
      const config = company.contentStudioAiConfig || {};
      const textPlain = String(config.geminiKey || "").trim();
      const imagePlain = String(config.imageGeminiKey || "").trim();

      try {
        if (mode === "audit") {
          if (
            (textPlain && !config.geminiKeyEncrypted?.ciphertext) ||
            (imagePlain && !config.imageGeminiKeyEncrypted?.ciphertext)
          ) summary.candidates += 1;
          continue;
        }

        if (mode === "apply") {
          const update = {
            "contentStudioAiConfig.credentialMigration": {
              migrationId: "content-studio-ai-keys-v1",
              appliedAt: new Date(),
              verifiedAt: null,
              textPlainFingerprint: fingerprintContentStudioCredential(textPlain),
              imagePlainFingerprint: fingerprintContentStudioCredential(imagePlain),
            },
          };
          if (textPlain) {
            update["contentStudioAiConfig.geminiKeyEncrypted"] =
              encryptContentStudioCredential(textPlain);
          }
          if (imagePlain) {
            update["contentStudioAiConfig.imageGeminiKeyEncrypted"] =
              encryptContentStudioCredential(imagePlain);
          }
          await Company.updateOne({ _id: company._id }, { $set: update });
          summary.migrated += 1;
          continue;
        }

        if (mode === "verify") {
          if (config.credentialMigration?.migrationId !== "content-studio-ai-keys-v1") {
            throw new Error("Migration marker is missing.");
          }
          const encryptedText = config.geminiKeyEncrypted?.ciphertext
            ? decryptContentStudioCredential(config.geminiKeyEncrypted)
            : "";
          const encryptedImage = config.imageGeminiKeyEncrypted?.ciphertext
            ? decryptContentStudioCredential(config.imageGeminiKeyEncrypted)
            : "";

          const textMatches =
            fingerprintContentStudioCredential(encryptedText) ===
            config.credentialMigration.textPlainFingerprint;
          const imageMatches =
            fingerprintContentStudioCredential(encryptedImage) ===
            config.credentialMigration.imagePlainFingerprint;

          if (!textMatches || !imageMatches) {
            throw new Error("Encrypted credentials do not match the migration fingerprints.");
          }

          await Company.updateOne(
            { _id: company._id },
            { $set: { "contentStudioAiConfig.credentialMigration.verifiedAt": new Date() } },
          );
          summary.verified += 1;
          continue;
        }

        if (mode === "rollback") {
          if (config.credentialMigration?.migrationId !== "content-studio-ai-keys-v1") {
            continue;
          }
          await Company.updateOne(
            { _id: company._id },
            {
              $unset: {
                "contentStudioAiConfig.geminiKeyEncrypted": "",
                "contentStudioAiConfig.imageGeminiKeyEncrypted": "",
                "contentStudioAiConfig.credentialMigration": "",
              },
            },
          );
          summary.rolledBack += 1;
        }
      } catch (error) {
        summary.failed.push({
          companyId: String(company._id),
          message: error.message,
        });
      }
    }

    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();

    if (summary.failed.length) process.exitCode = 1;
  };

  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
