import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

const getEncryptionKey = () => {
  const configuredKey = process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY;

  if (!configuredKey) {
    throw new Error("FACEBOOK_TOKEN_ENCRYPTION_KEY is not configured.");
  }

  const key = /^[a-f\d]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, "hex")
    : Buffer.from(configuredKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "FACEBOOK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes."
    );
  }

  return key;
};

export const encryptSecret = (plaintext) => {
  if (!plaintext) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
};

export const decryptSecret = (encryptedValue) => {
  if (!encryptedValue) return "";

  const [version, ivValue, authTagValue, ciphertextValue] =
    encryptedValue.split(":");

  if (
    version !== VERSION ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue
  ) {
    throw new Error("Encrypted secret has an unsupported format.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
