import { assertVoiceConsent } from "../services/digitalCloneVoiceService.js";

const requireDigitalCloneVoiceConsent = async (req, _res, next) => {
  try {
    req.digitalCloneVoice = await assertVoiceConsent({
      companyId: req.company?._id,
      userId: req.userId,
    });
    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireDigitalCloneVoiceConsent;
