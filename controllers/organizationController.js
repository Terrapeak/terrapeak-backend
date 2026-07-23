import asyncHandler from "express-async-handler";

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
} from "../services/organizationService.js";

const organizationResponse = (organization) => ({
  organizationId: organization._id,
  name: organization.name,
  slug: organization.slug,
  status: organization.status,
  isActive: organization.isActive,
  metadata: organization.metadata || {},
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
});

const membershipResponse = (membership) => {
  const populatedUser =
    membership.userId && typeof membership.userId === "object"
      ? membership.userId
      : null;

  return {
    membershipId: membership._id,
    organizationId: membership.organizationId?._id ||
      membership.organizationId,
    user: {
      userId: populatedUser?._id || membership.userId,
      name: populatedUser?.name || "",
      email: populatedUser?.email || "",
    },
    role: membership.role,
    status: membership.status,
    isActive: membership.isActive,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
};

const companyResponse = (company) => ({
  companyId: company._id,
  organizationId: company.organizationId,
  name: company.name,
  displayName: company.displayName,
  slug: company.slug,
  isActive: company.isActive,
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
          message: "One of the supplied identifiers is invalid.",
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
      platformManaged: result.platformManaged,
      message: result.platformManaged
        ? "Organization created without an initial owner and remains platform-managed."
        : "Organization and initial owner created.",
    });
  }
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
    res.json({
      success: true,
      organization: organizationResponse(organization),
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
      companies: companies.map(companyResponse),
    });
  }
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

export const getOrganizationMembers = organizationHandler(
  async (req, res) => {
    const memberships = await listOrganizationMembers({
      organization: req.organization,
      membership: req.organizationMembership,
    });
    res.json({
      success: true,
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
