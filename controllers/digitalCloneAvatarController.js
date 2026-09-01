import {
  acceptAvatarConsent, approveAvatarVideo, createAvatarVideo, discoverAvatars, getAvatarPreviewDelivery,
  getAvatarState, getAvatarVideoDelivery, refreshAvatarVideo, rejectAvatarVideo, revokeAvatar,
  selectAvatar, serializeAvatarVideo,
} from "../services/digitalCloneAvatarService.js";

const scope = (req) => ({ companyId: req.company._id, userId: req.userId });
export const getDigitalCloneAvatar = async (req, res, next) => { try { return res.json({ success: true, data: await getAvatarState(scope(req)) }); } catch (error) { return next(error); } };
export const acceptDigitalCloneAvatarConsent = async (req, res, next) => { try { await acceptAvatarConsent({ ...scope(req), body: req.body, acceptedIp: req.ip }); return res.json({ success: true, data: await getAvatarState(scope(req)) }); } catch (error) { return next(error); } };
export const discoverDigitalCloneAvatars = async (req, res, next) => { try { await discoverAvatars(scope(req)); return res.json({ success: true, data: await getAvatarState(scope(req)) }); } catch (error) { return next(error); } };
export const selectDigitalCloneAvatar = async (req, res, next) => { try { await selectAvatar({ ...scope(req), candidateId: req.params.candidateId }); return res.json({ success: true, data: await getAvatarState(scope(req)) }); } catch (error) { return next(error); } };
export const deliverDigitalCloneAvatarPreview = async (req, res, next) => { try { const { stream, mimeType } = await getAvatarPreviewDelivery({ ...scope(req), candidateId: req.params.candidateId }); res.set("Content-Type", mimeType); res.set("X-Content-Type-Options", "nosniff"); res.set("Cache-Control", "private, no-store"); stream.on("error", next); return stream.pipe(res); } catch (error) { return next(error); } };
export const createDigitalCloneAvatarVideo = async (req, res, next) => { try { const video = await createAvatarVideo({ ...scope(req), body: req.body }); return res.status(202).json({ success: true, data: serializeAvatarVideo(video) }); } catch (error) { return next(error); } };
export const getDigitalCloneAvatarVideoStatus = async (req, res, next) => { try { const video = await refreshAvatarVideo({ ...scope(req), videoId: req.params.videoId }); return res.json({ success: true, data: serializeAvatarVideo(video) }); } catch (error) { return next(error); } };
export const deliverDigitalCloneAvatarVideo = async (req, res, next) => { try { const { video, stream } = await getAvatarVideoDelivery({ ...scope(req), videoId: req.params.videoId }); res.set("Content-Type", video.mimeType || "video/mp4"); res.set("Content-Disposition", "inline"); res.set("X-Content-Type-Options", "nosniff"); res.set("Cache-Control", "private, no-store"); stream.on("error", next); return stream.pipe(res); } catch (error) { return next(error); } };
export const approveDigitalCloneAvatarVideo = async (req, res, next) => { try { const video = await approveAvatarVideo({ ...scope(req), videoId: req.params.videoId }); return res.json({ success: true, data: serializeAvatarVideo(video) }); } catch (error) { return next(error); } };
export const rejectDigitalCloneAvatarVideo = async (req, res, next) => { try { const video = await rejectAvatarVideo({ ...scope(req), videoId: req.params.videoId }); return res.json({ success: true, data: serializeAvatarVideo(video) }); } catch (error) { return next(error); } };
export const revokeDigitalCloneAvatar = async (req, res, next) => { try { await revokeAvatar(scope(req)); return res.json({ success: true, data: await getAvatarState(scope(req)) }); } catch (error) { return next(error); } };
