import {
  getBrandSettings,
  saveBrandSettings,
} from "../services/contentStudio/brandSettingsService.js";

const getCompanyId = (req) =>
  req.company?._id ||
  req.company?.id ||
  req.companyId ||
  req.companyContext?.companyId ||
  req.workspace?.companyId ||
  req.headers["x-company-id"];

const getUserId = (req) =>
  req.user?._id ||
  req.user?.id ||
  req.auth?.userId ||
  req.userId;

const sendControllerError = (res, error) => {
  console.error("Content Studio brand settings error:", error);

  const status =
    error.statusCode ||
    error.status ||
    (error.name === "ValidationError" ? 400 : 500);

  return res.status(status).json({
    success: false,
    message:
      status === 500
        ? "Content Studio could not complete the request."
        : error.message,
  });
};

export const getBrandSettingsController = async (req, res) => {
  try {
    const settings = await getBrandSettings({
      companyId: getCompanyId(req),
    });

    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

export const saveBrandSettingsController = async (req, res) => {
  try {
    const settings = await saveBrandSettings({
      companyId: getCompanyId(req),
      userId: getUserId(req),
      settings: req.body,
    });

    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};