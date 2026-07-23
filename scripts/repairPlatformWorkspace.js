import dotenv from "dotenv";
import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

dotenv.config();

const PLATFORM_OWNER_EMAIL = "timharmsen@gmail.com";
const CUSTOMER_OWNER_EMAIL = "connect@terrapeakgroup.com";
const CUSTOMER_COMPANY_SLUG = "terrapeak";
const PLATFORM_COMPANY_NAME = "Terrapeak Platform";
const PLATFORM_COMPANY_SLUG = "terrapeak-platform";
const REQUIRED_CONFIRMATION = "REPAIR_PLATFORM_WORKSPACE";
const AUDIT_MODE = process.argv.includes("--audit");

const serializeCompany = (company) => ({
  id: String(company._id),
  name: company.name,
  slug: company.slug,
  isPlatformWorkspace: company.isPlatformWorkspace,
  isActive: company.isActive,
  ownerUserId: String(company.ownerUserId),
});

const serializeMembership = (membership) => ({
  id: String(membership._id),
  companyId: String(membership.companyId),
  userId: String(membership.userId),
  role: membership.role,
  status: membership.status,
  isActive: membership.isActive,
});

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const platformOwner = await User.findOne({
      email: PLATFORM_OWNER_EMAIL,
      platformRole: "platform-owner",
    });
    const customerOwner = await User.findOne({
      email: CUSTOMER_OWNER_EMAIL,
      platformRole: "none",
    });
    const customerCompany = await Company.findOne({
      slug: CUSTOMER_COMPANY_SLUG,
    });
    const platformCompanies = await Company.find({
      isPlatformWorkspace: true,
    }).sort({ createdAt: 1 });
    const platformCompanyBySlug = await Company.findOne({
      slug: PLATFORM_COMPANY_SLUG,
    });
    const memberships = platformOwner
      ? await CompanyMembership.find({ userId: platformOwner._id }).sort({ createdAt: 1 })
      : [];

    if (AUDIT_MODE) {
      console.log(
        JSON.stringify(
          {
            success: true,
            mode: "audit",
            platformOwner: platformOwner
              ? {
                  id: String(platformOwner._id),
                  name: platformOwner.name,
                  email: platformOwner.email,
                  platformRole: platformOwner.platformRole,
                }
              : null,
            customerOwner: customerOwner
              ? {
                  id: String(customerOwner._id),
                  name: customerOwner.name,
                  email: customerOwner.email,
                  platformRole: customerOwner.platformRole,
                }
              : null,
            customerCompany: customerCompany
              ? serializeCompany(customerCompany)
              : null,
            platformCompanies: platformCompanies.map(serializeCompany),
            platformCompanyBySlug: platformCompanyBySlug
              ? serializeCompany(platformCompanyBySlug)
              : null,
            ownerMemberships: memberships.map(serializeMembership),
          },
          null,
          2
        )
      );
      return;
    }

    if (
      process.env.REPAIR_PLATFORM_WORKSPACE_CONFIRMATION !==
      REQUIRED_CONFIRMATION
    ) {
      throw new Error(
        `Set REPAIR_PLATFORM_WORKSPACE_CONFIRMATION=${REQUIRED_CONFIRMATION}.`
      );
    }

    if (!platformOwner) {
      throw new Error(
        `${PLATFORM_OWNER_EMAIL} is not the current platform owner. No data was changed.`
      );
    }
    if (!customerOwner) {
      throw new Error(
        `${CUSTOMER_OWNER_EMAIL} is not a separated customer account. No data was changed.`
      );
    }
    if (!customerCompany) {
      throw new Error(
        `Customer company ${CUSTOMER_COMPANY_SLUG} was not found. No data was changed.`
      );
    }
    if (String(customerCompany.ownerUserId) !== String(customerOwner._id)) {
      throw new Error(
        `Customer company ${CUSTOMER_COMPANY_SLUG} is not owned by ${CUSTOMER_OWNER_EMAIL}. No data was changed.`
      );
    }

    const unexpectedPlatformCompanies = platformCompanies.filter(
      (company) =>
        String(company._id) !== String(customerCompany._id) &&
        company.slug !== PLATFORM_COMPANY_SLUG
    );
    if (unexpectedPlatformCompanies.length > 0) {
      throw new Error(
        `Found unexpected platform workspaces: ${unexpectedPlatformCompanies
          .map((company) => company.slug)
          .join(", ")}. No data was changed.`
      );
    }

    customerCompany.isPlatformWorkspace = false;
    customerCompany.ownerUserId = customerOwner._id;
    customerCompany.isActive = true;
    await customerCompany.save();

    let platformCompany = platformCompanyBySlug;
    if (!platformCompany) {
      platformCompany = await Company.create({
        name: PLATFORM_COMPANY_NAME,
        displayName: PLATFORM_COMPANY_NAME,
        slug: PLATFORM_COMPANY_SLUG,
        country: "MY",
        ownerUserId: platformOwner._id,
        isActive: true,
        isPlatformWorkspace: true,
        installedApps: [],
        plan: "enterprise",
        billing: {
          status: "manual",
          paymentStatus: "manual",
        },
        maxUsers: 10,
      });
    } else {
      platformCompany.name = PLATFORM_COMPANY_NAME;
      platformCompany.displayName = PLATFORM_COMPANY_NAME;
      platformCompany.ownerUserId = platformOwner._id;
      platformCompany.isActive = true;
      platformCompany.isPlatformWorkspace = true;
      await platformCompany.save();
    }

    let membership = await CompanyMembership.findOne({
      companyId: platformCompany._id,
      userId: platformOwner._id,
    });

    if (!membership) {
      membership = await CompanyMembership.create({
        companyId: platformCompany._id,
        userId: platformOwner._id,
        role: "owner",
        status: "active",
      });
    } else {
      membership.role = "owner";
      membership.status = "active";
      membership.removedAt = null;
      membership.removedByUserId = null;
      await membership.save();
    }

    const finalPlatformCompanies = await Company.find({
      isPlatformWorkspace: true,
      isActive: true,
    }).sort({ createdAt: 1 });

    if (
      finalPlatformCompanies.length !== 1 ||
      String(finalPlatformCompanies[0]._id) !== String(platformCompany._id)
    ) {
      throw new Error(
        "Platform workspace repair did not produce exactly one active platform workspace."
      );
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          message: "Customer and platform workspaces separated.",
          customerCompany: serializeCompany(customerCompany),
          platformOwner: {
            id: String(platformOwner._id),
            name: platformOwner.name,
            email: platformOwner.email,
            platformRole: platformOwner.platformRole,
          },
          platformCompany: serializeCompany(platformCompany),
          membership: serializeMembership(membership),
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        code: "PLATFORM_WORKSPACE_REPAIR_FAILED",
        message: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
