import mongoose from "mongoose";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { provisionCompany } from "../services/companyProvisioningService.js";
import { getReservationsProvisioningHealth } from "../provisioners/reservationProvisioner.js";

dotenv.config();

const parseArguments = (args) => {
  const apply = args.includes("--apply");
  const unknownFlags = args.filter(
    (argument) => argument.startsWith("--") && argument !== "--apply"
  );
  const targets = args.filter((argument) => !argument.startsWith("--"));

  if (unknownFlags.length || targets.length !== 1) {
    throw new Error(
      "Usage: node scripts/repairReservationsProvisioning.js <company-slug-or-id> [--apply]"
    );
  }

  return { apply, target: targets[0] };
};

export async function repairReservationsProvisioning(args = process.argv.slice(2)) {
  const { apply, target } = parseArguments(args);
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const company = mongoose.isValidObjectId(target)
      ? await Company.findById(target)
      : await Company.findOne({ slug: target.trim().toLowerCase() });

    if (!company) throw new Error("Company not found.");

    const installation = await CompanyAppInstallation.findOne({
      companyId: company._id,
      appSlug: "reservations",
    }).lean();
    const before = await getReservationsProvisioningHealth({ company });

    console.log(
      JSON.stringify(
        {
          dryRun: !apply,
          companyId: company._id.toString(),
          companySlug: company.slug,
          installation: installation
            ? {
                enabled: installation.enabled,
                status: installation.status,
              }
            : null,
          health: before,
        },
        null,
        2
      )
    );

    if (!apply) return { applied: false, before };

    const mode = company.isPlatformWorkspace
      ? "platform-workspace"
      : "customer";
    const provisioning = await provisionCompany({
      companyId: company._id,
      ownerUserId: company.ownerUserId,
      mode,
      requestedAppSlugs: ["reservations"],
    });
    const refreshedCompany = await Company.findById(company._id);
    const after = await getReservationsProvisioningHealth({
      company: refreshedCompany,
    });

    console.log(
      JSON.stringify(
        {
          applied: true,
          provisioning,
          health: after,
        },
        null,
        2
      )
    );

    return { applied: true, provisioning, before, after };
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  repairReservationsProvisioning().catch((error) => {
    console.error(`Reservations provisioning repair failed: ${error.message}`);
    process.exitCode = 1;
  });
}
