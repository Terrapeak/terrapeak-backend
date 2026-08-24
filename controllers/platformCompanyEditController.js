import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import { isReservationsTemplate } from "../config/reservationsTemplates.js";
import { applyReservationsTemplate } from "../utils/reservationTemplateService.js";

const COMPANY_FIELDS = [
  "name",
  "displayName",
  "country",
  "address",
  "website",
  "email",
  "phone",
  "slug",
  "referencePrefix",
  "reservationBusinessSlug",
  "reservationTemplate",
  "plan",
  "maxUsers",
  "isActive",
];

const USER_FIELDS = ["name", "email", "phone", "country", "isApproved"];
const MEMBERSHIP_ROLES = new Set(["owner", "admin", "manager", "staff", "viewer"]);
const ACTIVITY_LIMIT = 50;

const cleanSlug = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const appendAdminActivity = async ({ companyId, title, actor, metadata = {} }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title,
              appSlug: "platform-admin",
              appName: "Platform Administration",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata,
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

const findReplacementOwner = async (companyId, excludedMembershipId = null) => {
  const query = { companyId, status: "active", role: "owner" };
  if (excludedMembershipId) query._id = { $ne: excludedMembershipId };
  return CompanyMembership.findOne(query).select("userId");
};

const ensureOwnerSafeguard = async ({ companyId, membership, nextRole, nextActive }) => {
  const removesOwner =
    membership.role === "owner" && (nextRole !== "owner" || nextActive === false);

  if (!removesOwner) return null;

  const replacementOwner = await findReplacementOwner(companyId, membership._id);
  if (!replacementOwner) {
    const error = new Error("A company must keep at least one active owner.");
    error.statusCode = 409;
    throw error;
  }

  return replacementOwner;
};

export const updatePlatformCompany = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const company = await Company.findById(companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const updates = {};
  COMPANY_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  if (updates.slug !== undefined) {
    updates.slug = cleanSlug(updates.slug);
    if (!updates.slug) {
      return res.status(400).json({ success: false, message: "Company slug is required." });
    }

    const duplicate = await Company.findOne({
      slug: updates.slug,
      _id: { $ne: company._id },
    }).select("_id");

    if (duplicate) {
      return res.status(409).json({ success: false, message: "Company slug is already in use." });
    }
  }

  if (updates.maxUsers !== undefined) {
    const maxUsers = Number(updates.maxUsers);
    if (!Number.isInteger(maxUsers) || maxUsers < 1) {
      return res.status(400).json({ success: false, message: "Maximum users must be at least 1." });
    }

    const activeMemberships = await CompanyMembership.countDocuments({
      companyId: company._id,
      status: "active",
    });

    if (maxUsers < activeMemberships) {
      return res.status(409).json({
        success: false,
        message: `Maximum users cannot be lower than the current ${activeMemberships} active users.`,
      });
    }

    updates.maxUsers = maxUsers;
  }

  let templateApplication = null;
  if (updates.reservationTemplate !== undefined) {
    if (!isReservationsTemplate(updates.reservationTemplate)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid Reservations template.",
      });
    }

    const templateChanged = updates.reservationTemplate !== company.reservationTemplate;
    if (templateChanged && company.reservationBusinessId) {
      templateApplication = await applyReservationsTemplate({
        businessId: company.reservationBusinessId,
        templateKey: updates.reservationTemplate,
        preserveExistingCustomizations: true,
      });
    }
  }

  Object.assign(company, updates);
  await company.save();

  await appendAdminActivity({
    companyId: company._id,
    title: "Company details updated",
    actor: req.platformUser,
    metadata: {
      fields: Object.keys(updates),
      ...(templateApplication
        ? {
            reservationTemplate: updates.reservationTemplate,
            addedReservationFields: templateApplication.addedFields,
          }
        : {}),
    },
  });

  res.json({ success: true, company });
});

export const addPlatformCompanyUser = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const { name, email, phone, country, password, role = "staff", isApproved = true } = req.body;

  const company = await Company.findById(companyId);
  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  if (!name || !email || !phone) {
    return res.status(400).json({
      success: false,
      message: "Name, email and phone are required.",
    });
  }

  if (!MEMBERSHIP_ROLES.has(role)) {
    return res.status(400).json({ success: false, message: "Invalid company role." });
  }

  const activeMemberships = await CompanyMembership.countDocuments({
    companyId: company._id,
    status: "active",
  });

  if (activeMemberships >= company.maxUsers) {
    return res.status(409).json({
      success: false,
      message: `This company has reached its maximum of ${company.maxUsers} active users.`,
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "A temporary password of at least 8 characters is required for a new user.",
      });
    }

    const phoneConflict = await User.findOne({ phone: String(phone).trim() }).select("_id");
    if (phoneConflict) {
      return res.status(409).json({ success: false, message: "Phone number is already in use." });
    }

    user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      password,
      country: country || company.country,
      companyName: company.name,
      role: "user",
      isAdmin: false,
      platformRole: "none",
      isApproved: Boolean(isApproved),
    });
  } else {
    const existingMembership = await CompanyMembership.findOne({
      companyId: company._id,
      userId: user._id,
    });

    if (existingMembership?.status === "active") {
      return res.status(409).json({ success: false, message: "This user already belongs to the company." });
    }

    user.name = String(name).trim();
    user.phone = String(phone).trim();
    user.country = country || user.country || company.country;
    user.companyName = company.name;
    user.isApproved = Boolean(isApproved);
    await user.save();

    if (existingMembership) {
      existingMembership.role = role;
      existingMembership.status = "active";
      await existingMembership.save();

      await appendAdminActivity({
        companyId: company._id,
        title: "Company user reactivated",
        actor: req.platformUser,
        metadata: { userId: user._id, email: user.email, role },
      });

      return res.status(200).json({ success: true, user, membership: existingMembership });
    }
  }

  const membership = await CompanyMembership.create({
    companyId: company._id,
    userId: user._id,
    role,
    status: "active",
  });

  await appendAdminActivity({
    companyId: company._id,
    title: "Company user added",
    actor: req.platformUser,
    metadata: { userId: user._id, email: user.email, role },
  });

  res.status(201).json({ success: true, user, membership });
});

export const updatePlatformCompanyUser = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const user = await User.findById(membership.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User record not found." });
  }

  const nextRole = req.body.role ?? membership.role;
  const nextActive =
    req.body.isActive ?? membership.status === "active";

  if (!MEMBERSHIP_ROLES.has(nextRole)) {
    return res.status(400).json({ success: false, message: "Invalid company role." });
  }

  const replacementOwner = await ensureOwnerSafeguard({
    companyId,
    membership,
    nextRole,
    nextActive,
  });

  if (membership.status !== "active" && nextActive) {
    const company = await Company.findById(companyId).select("maxUsers");
    const activeMemberships = await CompanyMembership.countDocuments({
      companyId,
      status: "active",
    });
    if (activeMemberships >= company.maxUsers) {
      return res.status(409).json({
        success: false,
        message: `This company has reached its maximum of ${company.maxUsers} active users.`,
      });
    }
  }

  for (const field of USER_FIELDS) {
    if (req.body[field] !== undefined) user[field] = req.body[field];
  }

  if (req.body.email !== undefined) user.email = String(req.body.email).trim().toLowerCase();
  if (req.body.phone !== undefined) user.phone = String(req.body.phone).trim();
  if (req.body.password) user.password = req.body.password;

  try {
    await user.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: `${Object.keys(error.keyPattern || {})[0] || "User field"} is already in use.`,
      });
    }
    throw error;
  }

  membership.role = nextRole;
  membership.status = nextActive ? "active" : "inactive";
  await membership.save();

  if (replacementOwner) {
    await Company.updateOne({ _id: companyId }, { ownerUserId: replacementOwner.userId });
  } else if (nextRole === "owner") {
    await Company.updateOne({ _id: companyId }, { ownerUserId: user._id });
  }

  await appendAdminActivity({
    companyId,
    title: "Company user updated",
    actor: req.platformUser,
    metadata: { userId: user._id, email: user.email, role: membership.role, isActive: membership.isActive },
  });

  res.json({ success: true, user, membership });
});

export const removePlatformCompanyUser = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const replacementOwner = await ensureOwnerSafeguard({
    companyId,
    membership,
    nextRole: membership.role,
    nextActive: false,
  });

  membership.status = "inactive";
  await membership.save();

  if (replacementOwner) {
    await Company.updateOne({ _id: companyId }, { ownerUserId: replacementOwner.userId });
  }

  const user = await User.findById(membership.userId).select("email");

  await appendAdminActivity({
    companyId,
    title: "Company user removed",
    actor: req.platformUser,
    metadata: { userId: membership.userId, email: user?.email || "" },
  });

  res.json({ success: true, membership });
});

