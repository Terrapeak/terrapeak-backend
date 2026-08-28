import {
  acceptVoiceConsent,
  approveVoice,
  createVoiceClone,
  deleteVoiceSample,
  generateVoicePreview,
  getVoicePreviewDelivery,
  getVoiceSampleDelivery,
  getVoiceState,
  listVoiceSamples,
  revokeVoice,
  serializeVoice,
  serializeVoicePreview,
  serializeVoiceSample,
  updateVoiceSettings,
  uploadVoiceSamples,
  voiceError,
} from "../services/digitalCloneVoiceService.js";

const scope = (req) => ({ companyId: req.company._id, userId: req.userId });

export const getDigitalCloneVoice = async (req, res, next) => {
  try {
    return res.json({ success: true, data: await getVoiceState(scope(req)) });
  } catch (error) {
    return next(error);
  }
};

export const acceptDigitalCloneVoiceConsent = async (req, res, next) => {
  try {
    const voice = await acceptVoiceConsent({
      ...scope(req),
      body: req.body,
      acceptedIp: req.ip,
    });
    return res.json({ success: true, data: serializeVoice(voice) });
  } catch (error) {
    return next(error);
  }
};

const parseDurationHints = (value) => {
  if (value === undefined || value === "") return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed) || parsed.length > 3) throw new Error("invalid");
    return parsed;
  } catch {
    throw voiceError("Recording duration metadata is invalid.", 400, "VOICE_SAMPLE_DURATION_INVALID");
  }
};

export const uploadDigitalCloneVoiceSamples = async (req, res, next) => {
  try {
    const samples = await uploadVoiceSamples({
      ...scope(req),
      files: req.files,
      durationHints: parseDurationHints(req.body?.durations),
    });
    return res.status(201).json({ success: true, data: samples.map(serializeVoiceSample) });
  } catch (error) {
    return next(error);
  }
};

export const listDigitalCloneVoiceSamples = async (req, res, next) => {
  try {
    const samples = await listVoiceSamples(scope(req));
    return res.json({ success: true, data: samples.map(serializeVoiceSample) });
  } catch (error) {
    return next(error);
  }
};

export const deliverDigitalCloneVoiceSample = async (req, res, next) => {
  try {
    const { sample, stream } = await getVoiceSampleDelivery({
      ...scope(req),
      sampleId: req.params.sampleId,
    });
    res.set("Content-Type", sample.mimeType);
    res.set("Content-Disposition", "inline");
    res.set("Cache-Control", "private, no-store");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (error) {
    return next(error);
  }
};

export const deleteDigitalCloneVoiceSample = async (req, res, next) => {
  try {
    const sample = await deleteVoiceSample({
      ...scope(req),
      sampleId: req.params.sampleId,
    });
    return res.json({ success: true, data: serializeVoiceSample(sample) });
  } catch (error) {
    return next(error);
  }
};

export const updateDigitalCloneVoiceSettings = async (req, res, next) => {
  try {
    const voice = await updateVoiceSettings({ ...scope(req), body: req.body });
    return res.json({ success: true, data: serializeVoice(voice) });
  } catch (error) {
    return next(error);
  }
};

export const createDigitalCloneVoice = async (req, res, next) => {
  try {
    const voice = await createVoiceClone(scope(req));
    return res.status(202).json({ success: true, data: serializeVoice(voice) });
  } catch (error) {
    return next(error);
  }
};

export const generateDigitalCloneVoicePreview = async (req, res, next) => {
  try {
    const preview = await generateVoicePreview({ ...scope(req), body: req.body });
    return res.status(201).json({ success: true, data: serializeVoicePreview(preview) });
  } catch (error) {
    return next(error);
  }
};

export const deliverDigitalCloneVoicePreview = async (req, res, next) => {
  try {
    const { preview, stream } = await getVoicePreviewDelivery({
      ...scope(req),
      previewId: req.params.previewId,
    });
    res.set("Content-Type", preview.mimeType);
    res.set("Content-Disposition", "inline");
    res.set("Cache-Control", "private, no-store");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (error) {
    return next(error);
  }
};

export const approveDigitalCloneVoice = async (req, res, next) => {
  try {
    const voice = await approveVoice({ ...scope(req), previewId: req.params.previewId });
    return res.json({ success: true, data: serializeVoice(voice) });
  } catch (error) {
    return next(error);
  }
};

export const revokeDigitalCloneVoice = async (req, res, next) => {
  try {
    const voice = await revokeVoice(scope(req));
    return res.json({ success: true, data: serializeVoice(voice) });
  } catch (error) {
    return next(error);
  }
};
