import asyncHandler from "express-async-handler";
import Company from "../models/company.js";

export const listPlatformCompanies = asyncHandler(async (req, res) => {
  const query = (req.query.q || "").trim();
  const customerFilter = { isPlatformWorkspace: { $ne: true } };

  const filter = query
    ? {
        ...customerFilter,
        $or: [
          { name: { $regex: query, $options: "i" } },
          { displayName: { $regex: query, $options: "i" } },
          { slug: { $regex: query, $options: "i" } },
        ],
      }
    : customerFilter;

  const companies = await Company.find(filter)
    .select(
      "name displayName slug plan isActive email country organizationId createdAt"
    )
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    companies,
  });
});
