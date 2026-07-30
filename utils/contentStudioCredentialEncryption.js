import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;

const getMasterKey = () => {
  const configured = String(
    process.env.CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY || "",
  ).trim();

  let key;
  if (/^[a-f0-9]{64}$/i.test(configured)) {
    key = Buffer.from(configured, "hex");
  } else {
    try {
      key = Buffer.from(configured, "base64");
    } catch {
      key = Buffer.alloc(0);
    }
  }

  if (key.length !== 32) {
    const error = new Error(
      "CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hexadecimal value.",
    );
    error.code = "CONTENT_STUDIO_ENCRYPTION_KEY_INVALID";
    throw error;
  }

  return key;
};

export const encryptContentStudioCredential = (plaintext) => {
  const value = String(plaintext || "").trim();
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
    lastFour: value.slice(-4),
  };
};

export const decryptContentStudioCredential = (encrypted) => {
  if (!encrypted?.ciphertext || !encrypted?.iv || !encrypted?.authTag) {
    return "";
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

export const resolveCompanyContentStudioKeys = (company) => {
  const config = company?.contentStudioAiConfig || {};
  return {
    textKey: config.geminiKeyEncrypted?.ciphertext
      ? decryptContentStudioCredential(config.geminiKeyEncrypted)
      : String(config.geminiKey || "").trim(),
    imageKey: config.imageGeminiKeyEncrypted?.ciphertext
      ? decryptContentStudioCredential(config.imageGeminiKeyEncrypted)
      : String(config.imageGeminiKey || "").trim(),
  };
};

export const fingerprintContentStudioCredential = (plaintext) =>
  crypto.createHash("sha256").update(String(plaintext || ""), "utf8").digest("hex");
