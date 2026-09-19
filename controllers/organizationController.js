import asyncHandler from "express-async-handler";
import App from "../models/app.js";
import {
  isDistributorOrganization,
  normalizeOrganizationType,
} from "../utils/organizationTypes.js";
import { COMPANY_ACCESS_SOURCES } from "../services/companyAccessService.js";

import {
  OrganizationServiceError,
  addOrganizationMember,
  assignCompanyToOrganization,
  assignInitialOrganizationOwner,
  createOrganization,
  listAvailableOrganizations,
  listOrganizationCompanies,
  listOrganizationMembers,
  listPlatformOrganizations,
  readOrganization,
  readPlatformOrganization,
  removeCompanyFromOrganization,
  removeOrganizationMember,
  updateOrganization,
  updateOrganizationMember,
  updatePlatformOrganization,
  lookupInitialOwner,
} from "../services/organizationService.js";
import { createDistributorCompany } from "../services/distributorCompanyService.js";
import {
  archiveCompany,
  restoreCompany,
} from "../services/companyLifecycleService.js";
import {
  sendOrganizationOwnerPasswordReset,
  updateOrganizationOwner,
} from "../services/organizationOwnerService.js";
import {
  listEligibleOrganizationOwnerCandidates,
  transferOrganizationOwner,
} from "../services/organizationOwnerTransferService.js";
import {
  ORGANIZATION_OWNER_INTEGRITY,
  organizationOwnerIntegrityError,
  resolveOrganizationOwnerIntegrity,
} from "../services/organizationOwnerIntegrityService.js";

export const organizationResponse = (organization) => ({
  organizationId: organization._id,
  name: organization.name,
  slug: organization.slug,
  organizationType: normalizeOrganizationType(organization.organizationType),
  status: organization.status,
  isActive: organization.isActive,
  metadata: organization.metadata || {},
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
});

const membershipResponse = (membership, userOverride = null) => {
  const populatedUser =
    membership.userId && typeof membership.userId === "object"
      ? membership.userId
      : null;
  const user = userOverride || populatedUser;

  return {
    membershipId: membership._id,
    organizationId: membership.organizationId?._id ||
      membership.organizationId,
    user: {
      userId: user?._id || membership.userId,
      name: user?.name || "",
      email: user?.email || "",
    },
    role: membership.role,
    status: membership.status,
    isActive: membership.isActive,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
};

const companyResponse = (company, { accessSource = null } = {}) => ({
  companyId: company._id,
  organizationId: company.organizationId,
  name: company.name,
  displayName: company.displayName,
  slug: company.slug,
  isActive: company.isActive,
  lifecycleStatus: company.lifecycleStatus || (company.isActive === false ? "archived" : "active"),
  archivedAt: company.archivedAt || null,
  archiveReason: company.archiveReason || "",
  installedApps: company.installedApps || [],
  ...(accessSource ? { accessSource } : {}),
});

const distributorCompanyResponse = (result) => ({
  company: companyResponse(result.company),
  user: {
    userId: result.user._id,
    name: result.user.name,
    email: result.user.email,
  },
  membership: membershipResponse(result.membership),
  installedApps: result.installedApps,
  billingSource: result.company.billingSource,
  billingScope:
    result.company.billingSource === "organization"
      ? "organization"
      : "company",
});

const organizationHandler = (handler) =>
  asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof OrganizationServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }

      if (error?.statusCode && error?.code) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }

      if (error?.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          code: "ORGANIZATION_VALIDATION_FAILED",
          message: "The Organization request is invalid.",
        });
      }

      if (error?.name === "CastError") {
        return res.status(400).json({
          success: false,
          code: "INVALID_IDENTIFIER",
          message: "The supplied identifier is invalid. Use an email address or a valid existing User ID.",
        });
      }

      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          code: "ORGANIZATION_RESOURCE_CONFLICT",
          message: "The Organization request conflicts with an existing record.",
        });
      }

      console.error("Organization request failed:", error);
      return res.status(500).json({
        success: false,
        code: "ORGANIZATION_REQUEST_FAILED",
        message: "The Organization request could not be completed.",
      });
    }
  });

export const createPlatformOrganization = organizationHandler(
  async (req, res) => {
    const result = await createOrganization({
      actor: req.platformUser,
      input: req.body || {},
    });

    res.status(201).json({
      success: true,
      organization: organizationResponse(result.organization),
      initialOwnerMembership: result.initialOwnerMembership
        ? membershipResponse(result.initialOwnerMembership)
        : null,
      initialOwner: result.initialOwnerUser
        ? {
            name: result.initialOwnerUser.name,
            email: result.initialOwnerUser.email,
            dashboardUrl: "dashboard.terrapeakgroup.com",
          }
        : null,
      platformManaged: result.platformManaged,
      message: result.platformManaged
        ? "Organization created without an initial owner and remains platform-managed."
        : "Organization and initial owner created.",
    });
  }
);

export const lookupPlatformOrganizationOwner = organizationHandler(
  async (req, res) => {
    const result = await lookupInitialOwner({ email: req.query.email });
    res.json({ success: true, ...result });
  },
);

export const getPlatformOrganizations = organizationHandler(
  async (req, res) => {
    const organizations = await listPlatformOrganizations({
      actor: req.platformUser,
    });
    res.json({
      success: true,
      organizations: organizations.map(organizationResponse),
    });
  }
);

export const getPlatformOrganization = organizationHandler(
  async (req, res) => {
    const organization = await readPlatformOrganization({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
    });
    const ownerIntegrity = await resolveOrganizationOwnerIntegrity({
      organizationId: organization._id,
    });
    if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
      throw organizationOwnerIntegrityError(
        "This Organization has multiple active owners and requires integrity review.",
      );
    }
    const activeOwner = ownerIntegrity.ownerMembership;
    if (activeOwner) {
      await activeOwner.populate("userId", "_id name email");
    }
    res.json({
      success: true,
      organization: organizationResponse(organization),
      activeOwner: activeOwner ? membershipResponse(activeOwner) : null,
    });
  }
);

export const patchPlatformOrganization = organizationHandler(
  async (req, res) => {
    const organization = await updatePlatformOrganization({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
      updates: req.body || {},
    });
    res.json({
      success: true,
      organization: organizationResponse(organization),
    });
  }
);

export const addPlatformOrganizationOwner = organizationHandler(
  async (req, res) => {
    const membership = await assignInitialOrganizationOwner({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
      userId: req.body?.userId,
    });
    res.status(201).json({
      success: true,
      membership: membershipResponse(membership),
    });
  }
);

export const attachPlatformOrganizationCompany = organizationHandler(
  async (req, res) => {
    const organization = await readPlatformOrganization({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
    });
    const company = await assignCompanyToOrganization({
      organization,
      companyId: req.params.companyId,
      platformActor: req.platformUser,
    });
    res.json({ success: true, company: companyResponse(company) });
  }
);

export const detachPlatformOrganizationCompany = organizationHandler(
  async (req, res) => {
    const organization = await readPlatformOrganization({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
    });
    const company = await removeCompanyFromOrganization({
      organization,
      companyId: req.params.companyId,
      platformActor: req.platformUser,
    });
    res.json({ success: true, company: companyResponse(company) });
  }
);

export const getMyOrganizations = organizationHandler(
  async (req, res) => {
    const memberships = await listAvailableOrganizations({
      userId: req.userId,
    });
    const organizations = memberships
      .filter((membership) => membership.organizationId)
      .map((membership) => ({
        ...organizationResponse(membership.organizationId),
        membership: {
          membershipId: membership._id,
          role: membership.role,
          status: membership.status,
        },
      }));

    res.json({ success: true, organizations });
  }
);

export const getOrganization = organizationHandler(async (req, res) => {
  const organization = await readOrganization({
    organization: req.organization,
    membership: req.organizationMembership,
  });
  res.json({
    success: true,
    organization: organizationResponse(organization),
    membership: {
      membershipId: req.organizationMembership._id,
      role: req.organizationMembership.role,
      status: req.organizationMembership.status,
    },
  });
});

export const patchOrganization = organizationHandler(
  async (req, res) => {
    const organization = await updateOrganization({
      organization: req.organization,
      membership: req.organizationMembership,
      updates: req.body || {},
    });
    res.json({
      success: true,
      organization: organizationResponse(organization),
    });
  }
);

export const getOrganizationCompanies = organizationHandler(
  async (req, res) => {
    const companies = await listOrganizationCompanies({
      organization: req.organization,
      membership: req.organizationMembership,
    });
    res.json({
      success: true,
      companies: companies.map((company) =>
        companyResponse(company, {
          accessSource:
            isDistributorOrganization(req.organization) &&
            ["owner", "admin"].includes(req.organizationMembership.role)
              ? COMPANY_ACCESS_SOURCES.DISTRIBUTOR_DELEGATED
              : null,
        }),
      ),
    });
  }
);

export const getDistributorCompanyOptions = organizationHandler(
  async (req, res) => {
    if (req.organization.organizationType !== "distributor") {
      return res.status(403).json({
        success: false,
        code: "DISTRIBUTOR_ORGANIZATION_REQUIRED",
        message: "Only Distributor Organizations can create Customers here.",
      });
    }
    const apps = await App.find({
      isVisible: true,
      isComingSoon: false,
      allowInstall: { $ne: false },
    })
      .select("slug name description category isCore requiresAIAssistant dependencies sortOrder")
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json({
      success: true,
      billingMode: req.organization.billingMode || "company",
      plan: req.organization.plan || "starter",
      maxCompanies: req.organization.billing?.maxCompanies ?? null,
      apps,
    });
  },
);

export const createDistributorOrganizationCompany = organizationHandler(
  async (req, res) => {
    const result = await createDistributorCompany({
      organization: req.organization,
      actorMembership: req.organizationMembership,
      input: req.body || {},
    });
    res.status(201).json({
      success: true,
      organization: organizationResponse(req.organization),
      ...distributorCompanyResponse(result),
    });
  },
);

export const attachOrganizationCompany = organizationHandler(
  async (req, res) => {
    const company = await assignCompanyToOrganization({
      organization: req.organization,
      companyId: req.params.companyId,
      actorMembership: req.organizationMembership,
    });
    res.json({ success: true, company: companyResponse(company) });
  }
);

export const detachOrganizationCompany = organizationHandler(
  async (req, res) => {
    const company = await removeCompanyFromOrganization({
      organization: req.organization,
      companyId: req.params.companyId,
      actorMembership: req.organizationMembership,
    });
    res.json({ success: true, company: companyResponse(company) });
  }
);

export const patchPlatformOrganizationOwner = organizationHandler(
  async (req, res) => {
    const user = await updateOrganizationOwner({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
      updates: req.body || {},
    });
    res.json({
      success: true,
      owner: {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
    });
  },
);

export const postPlatformOrganizationOwnerPasswordReset = organizationHandler(
  async (req, res) => {
    await sendOrganizationOwnerPasswordReset({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
    });
    res.json({
      success: true,
      message: "Password reset email sent.",
    });
  },
);

export const getPlatformOrganizationOwnerCandidates = organizationHandler(
  async (req, res) => {
    const candidates = await listEligibleOrganizationOwnerCandidates({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
    });
    res.json({ success: true, candidates });
  },
);

export const postPlatformOrganizationOwnerTransfer = organizationHandler(
  async (req, res) => {
    const result = await transferOrganizationOwner({
      actor: req.platformUser,
      organizationId: req.params.organizationId,
      newOwner: req.body?.newOwner,
      formerOwnerAction: req.body?.formerOwnerAction,
    });
    res.json({
      success: true,
      organization: organizationResponse(result.organization),
      activeOwner: membershipResponse(result.ownerMembership, result.ownerUser),
      formerOwner: membershipResponse(
        result.formerOwnerMembership,
        result.formerOwnerUser,
      ),
      notificationSent: result.notificationSent,
      notificationPending: result.notificationPending,
    });
  },
);

export const archiveOrganizationCompany = organizationHandler(
  async (req, res) => {
    const result = await archiveCompany({
      companyId: req.params.companyId,
      organization: req.organization,
      actorMembership: req.organizationMembership,
      reason: req.body?.reason,
    });
    res.json({
      success: true,
      alreadyArchived: result.alreadyArchived,
      company: companyResponse(result.company),
    });
  },
);

export const restoreOrganizationCompany = organizationHandler(
  async (req, res) => {
    const result = await restoreCompany({
      companyId: req.params.companyId,
      organization: req.organization,
      actorMembership: req.organizationMembership,
      reason: req.body?.reason,
    });
    res.json({
      success: true,
      alreadyActive: result.alreadyActive,
      company: companyResponse(result.company),
    });
  },
);

export const getOrganizationMembers = organizationHandler(
  async (req, res) => {
    const memberships = await listOrganizationMembers({
      organization: req.organization,
      membership: req.organizationMembership,
    });
    res.json({
      success: true,
      actorMembership: {
        membershipId: req.organizationMembership._id,
        role: req.organizationMembership.role,
        status: req.organizationMembership.status,
      },
      members: memberships.map(membershipResponse),
    });
  }
);

export const createOrganizationMember = organizationHandler(
  async (req, res) => {
    const membership = await addOrganizationMember({
      organization: req.organization,
      actorMembership: req.organizationMembership,
      input: req.body || {},
    });
    res.status(201).json({
      success: true,
      membership: membershipResponse(membership),
    });
  }
);

export const patchOrganizationMember = organizationHandler(
  async (req, res) => {
    const membership = await updateOrganizationMember({
      organization: req.organization,
      actorMembership: req.organizationMembership,
      membershipId: req.params.membershipId,
      updates: req.body || {},
    });
    res.json({
      success: true,
      membership: membershipResponse(membership),
    });
  }
);

export const deleteOrganizationMember = organizationHandler(
  async (req, res) => {
    const membership = await removeOrganizationMember({
      organization: req.organization,
      actorMembership: req.organizationMembership,
      membershipId: req.params.membershipId,
    });
    res.json({
      success: true,
      membership: membershipResponse(membership),
    });
  }
);
