import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/company.js";
import { findReservationBusinessBySlug } from "../utils/reservationService.js";

dotenv.config();

const parseArguments = (args) => {
  const apply = args.includes("--apply");
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const unknownFlags = args.filter(
    (argument) => argument.startsWith("--") && argument !== "--apply",
  );

  if (unknownFlags.length || positional.length > 1) {
    throw new Error(
      "Usage: node scripts/backfillReservationsBusinessIds.js [company-slug-or-id] [--apply]",
    );
  }

  return { apply, target: positional[0] || "" };
};

const buildCompanyFilter = (target) => {
  const base = {
    installedApps: "reservations",
    reservationBusinessSlug: { $nin: [null, ""] },
    $or: [
      { reservationBusinessId: null },
      { reservationBusinessId: { $exists: false } },
    ],
  };

  if (!target) return base;

  if (mongoose.isValidObjectId(target)) {
    return { ...base, _id: target };
  }

  return { ...base, slug: String(target).trim().toLowerCase() };
};

export async function backfillReservationsBusinessIds(
  args = process.argv.slice(2),
) {
  const { apply, target } = parseArguments(args);
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const companies = await Company.find(buildCompanyFilter(target)).sort({
      createdAt: 1,
    });

    const results = [];

    for (const company of companies) {
      const business = await findReservationBusinessBySlug(
        company.reservationBusinessSlug,
      );
      const businessId = Number(business?.id);
      const mapped = Number.isFinite(businessId);

      const result = {
        companyId: company._id.toString(),
        companySlug: company.slug,
        reservationBusinessSlug: company.reservationBusinessSlug,
        reservationBusinessId: mapped ? businessId : null,
        status: mapped ? (apply ? "updated" : "ready") : "not_found",
      };

      if (mapped && apply) {
        company.reservationBusinessId = businessId;
        await company.save();
      }

      results.push(result);
    }

    const summary = {
      dryRun: !apply,
      scanned: companies.length,
      mapped: results.filter((result) => result.reservationBusinessId).length,
      missing: results.filter((result) => !result.reservationBusinessId).length,
      results,
    };

    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await mongoose.disconnect();
  }
}

backfillReservationsBusinessIds().catch((error) => {
  console.error(`Reservations business ID backfill failed: ${error.message}`);
  process.exitCode = 1;
});
