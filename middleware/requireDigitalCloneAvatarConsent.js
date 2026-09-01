import { assertAvatarConsent } from "../services/digitalCloneAvatarService.js";
export default async function requireDigitalCloneAvatarConsent(req, _res, next) {
  try { req.digitalCloneAvatar = await assertAvatarConsent({ companyId: req.company?._id, userId: req.userId }); return next(); }
  catch (error) { return next(error); }
}
