import {
  approveTestCloneScript,
  approveTestCloneVideo,
  createTestCloneFromApprovedDraft,
  deliverTestCloneVideo,
  editTestCloneScript,
  generateTestCloneScript,
  generateTestCloneVideo,
  getTestCloneState,
  refreshTestCloneVideo,
  rejectTestCloneVideo,
  serializeTestClone,
} from "../services/digitalCloneTestCloneService.js";

const scope = (req) => ({ companyId: req.company?._id, userId: req.userId });
const state = async (req) => getTestCloneState(scope(req));

export const getDigitalCloneTestClone = async (req, res, next) => {
  try { return res.json({ success: true, data: await state(req) }); } catch (error) { return next(error); }
};

export const generateDigitalCloneTestCloneScript = async (req, res, next) => {
  try {
    const record = await generateTestCloneScript({ company: req.company, userId: req.userId, body: req.body });
    return res.status(201).json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const createDigitalCloneTestCloneFromDraft = async (req, res, next) => {
  try {
    const record = await createTestCloneFromApprovedDraft({ ...scope(req), body: req.body });
    return res.status(201).json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const updateDigitalCloneTestCloneScript = async (req, res, next) => {
  try {
    const record = await editTestCloneScript({ ...scope(req), testCloneId: req.params.testCloneId, body: req.body });
    return res.json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const approveDigitalCloneTestCloneScript = async (req, res, next) => {
  try {
    const record = await approveTestCloneScript({ ...scope(req), testCloneId: req.params.testCloneId });
    return res.json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const generateDigitalCloneTestCloneVideo = async (req, res, next) => {
  try {
    const record = await generateTestCloneVideo({ ...scope(req), testCloneId: req.params.testCloneId, body: req.body });
    return res.status(202).json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const getDigitalCloneTestCloneVideoStatus = async (req, res, next) => {
  try {
    const record = await refreshTestCloneVideo({ ...scope(req), testCloneId: req.params.testCloneId });
    return res.json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const deliverDigitalCloneTestCloneVideo = async (req, res, next) => {
  try {
    const { video, stream } = await deliverTestCloneVideo({ ...scope(req), testCloneId: req.params.testCloneId });
    res.set("Content-Type", video.mimeType || "video/mp4");
    res.set("Content-Disposition", "inline");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (error) { return next(error); }
};

export const approveDigitalCloneTestCloneVideo = async (req, res, next) => {
  try {
    const record = await approveTestCloneVideo({ ...scope(req), testCloneId: req.params.testCloneId });
    return res.json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};

export const rejectDigitalCloneTestCloneVideo = async (req, res, next) => {
  try {
    const record = await rejectTestCloneVideo({ ...scope(req), testCloneId: req.params.testCloneId });
    return res.json({ success: true, data: serializeTestClone(record) });
  } catch (error) { return next(error); }
};
