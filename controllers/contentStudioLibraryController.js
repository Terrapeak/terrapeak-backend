import {
  deleteContent,
  getContentById,
  getContentLibrary,
  saveContent,
  updateContent,
} from "../services/contentStudio/saveContentService.js";

const getCompanyId = (req) => req.company?._id;

const getUserId = (req) =>
  req.user?._id ||
  req.user?.id ||
  req.auth?.userId ||
  req.userId;

const sendControllerError = (res, error) => {
  console.error("Content Studio library error:", error);

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

export const saveContentController = async (req, res) => {
  try {
    const savedContent = await saveContent({
      companyId: getCompanyId(req),
      userId: getUserId(req),
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      data: savedContent,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

export const getContentLibraryController = async (req, res) => {
  try {
    const result = await getContentLibrary({
      companyId: getCompanyId(req),
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      contentType: req.query.contentType,
      sort: req.query.sort,
      order: req.query.order,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

export const getContentByIdController = async (req, res) => {
  try {
    const content = await getContentById({
      companyId: getCompanyId(req),
      contentId: req.params.id,
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Content was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: content,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

export const updateContentController = async (req, res) => {
  try {
    const content = await updateContent({
      companyId: getCompanyId(req),
      userId: getUserId(req),
      contentId: req.params.id,
      updates: req.body,
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Content was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: content,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

export const deleteContentController = async (req, res) => {
  try {
    const deletedContent = await deleteContent({
      companyId: getCompanyId(req),
      contentId: req.params.id,
    });

    if (!deletedContent) {
      return res.status(404).json({
        success: false,
        message: "Content was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Content deleted.",
      data: {
        id: deletedContent._id,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};
