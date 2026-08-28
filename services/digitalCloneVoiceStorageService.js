import axios from "axios";
import { v2 as cloudinary } from "cloudinary";

const storageError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw storageError("Voice media storage is not configured.", 503, "VOICE_STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

export const uploadPrivateVoiceAudio = ({ buffer, companyId, userId, kind, filename }) => {
  configureCloudinary();
  if (!new Set(["samples", "previews"]).has(kind)) {
    throw storageError("Voice storage destination is invalid.", 500, "VOICE_STORAGE_INVALID");
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `terrapeak/digital-clone/${companyId}/${userId}/voice/${kind}`,
        resource_type: "video",
        type: "authenticated",
        use_filename: true,
        unique_filename: true,
        filename_override: filename,
      },
      (error, result) => (error ? reject(storageError("Voice media could not be stored.", 502, "VOICE_STORAGE_UPLOAD_FAILED")) : resolve(result)),
    );
    stream.end(buffer);
  });
};

export const destroyPrivateVoiceAudio = async (storagePublicId) => {
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(storagePublicId, {
    resource_type: "video",
    type: "authenticated",
    invalidate: true,
  });
  if (!["ok", "not found"].includes(result?.result)) {
    throw storageError("Voice media could not be removed from private storage.", 502, "VOICE_STORAGE_DELETE_FAILED");
  }
};

const signedInternalUrl = (storagePublicId) => {
  configureCloudinary();
  return cloudinary.url(storagePublicId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "video",
  });
};

export const readPrivateVoiceAudio = async ({ storagePublicId, maxBytes = 25 * 1024 * 1024, fetchAudio = axios.get }) => {
  try {
    const response = await fetchAudio(signedInternalUrl(storagePublicId), {
      responseType: "arraybuffer",
      timeout: 20_000,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });
    return Buffer.from(response.data);
  } catch {
    throw storageError("Voice media is temporarily unavailable.", 502, "VOICE_STORAGE_DELIVERY_FAILED");
  }
};

export const streamPrivateVoiceAudio = async ({ storagePublicId, maxBytes = 25 * 1024 * 1024, fetchAudio = axios.get }) => {
  try {
    const response = await fetchAudio(signedInternalUrl(storagePublicId), {
      responseType: "stream",
      timeout: 20_000,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });
    return response.data;
  } catch {
    throw storageError("Voice media is temporarily unavailable.", 502, "VOICE_STORAGE_DELIVERY_FAILED");
  }
};
