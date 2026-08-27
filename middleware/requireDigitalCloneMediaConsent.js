import { assertDigitalCloneMediaConsent } from "../services/digitalCloneVisualIdentityService.js";

const requireDigitalCloneMediaConsent = async (req, res, next) => {
  try {
    await assertDigitalCloneMediaConsent({
      companyId: req.company?._id,
      userId: req.userId,
    });
    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireDigitalCloneMediaConsent;
