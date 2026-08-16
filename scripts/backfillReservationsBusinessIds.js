import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/company.js";
import { findReservationBusinessBySlug } from "../utils/reservationService.js";

dotenv.config();

const parseArguments = (args) => {
  const apply = args.includes("--apply");
  const repair = args.includes("--repair");
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const unknownFlags = args.filter(
    (argument) =>
      argument.startsWith("--") &&
      !["--apply", "--repair"].includes(argument),
  );

  if (unknownFlags.length || positional.length > 1 || (repair && !apply)) {
    throw new Error(
      "Usage: node scripts/backfillReservationsBusinessIds.js [company-slug-or-id] [--apply] [--repair]",
    );
  }

  return { apply, repair, target: positional[0] || "" };
};

const buildCompanyFilter = (target) => {
  const base = { installedApps: "reservations" };

  if (!target) return base;

  if (mongoose.isValidObjectId(target)) {
    return { ...base, _id: target };
  }

  return { ...base, slug: String(target).trim().toLowerCase() };
};

const finitePositiveId = (value) => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
};

export async function backfillReservationsBusinessIds(
  args = process.argv.slice(2),
) {
  const { apply, repair, target } = parseArguments(args);
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const companies = await Company.find(buildCompanyFilter(target)).sort({
      createdAt: 1,
    });

    const results = [];

    for (const company of companies) {
      const storedId = finitePositiveId(company.reservationBusinessId);
      const storedSlug = String(company.reservationBusinessSlug || "").trim();

      if (!storedSlug) {
        results.push({
          companyId: company._id.toString(),
          companySlug: company.slug,
          reservationBusinessSlug: "",
          storedReservationBusinessId: storedId,
          canonicalReservationBusinessId: null,
          status: "missing_slug",
          changed: false,
        });
        continue;
      }

      const business = await findReservationBusinessBySlug(storedSlug);
      const canonicalId = finitePositiveId(business?.id);

      let status;
      if (!canonicalId) {
        status = "not_found";
      } else if (!storedId) {
        status = apply ? "updated" : "ready";
      } else if (storedId === canonicalId) {
        status = "consistent";
      } else {
        status = repair ? "repaired" : "mismatch";
      }

      const shouldBackfill = Boolean(canonicalId && !storedId && apply);
      const shouldRepair = Boolean(
        canonicalId && storedId && storedId !== canonicalId && apply && repair,
      );
      const changed = shouldBackfill || shouldRepair;

      if (changed) {
        company.reservationBusinessId = canonicalId;
        await company.save();
      }

      results.push({
        companyId: company._id.toString(),
        companySlug: company.slug,
        reservationBusinessSlug: storedSlug,
        storedReservationBusinessId: storedId,
        canonicalReservationBusinessId: canonicalId,
        status,
        changed,
      });
    }

    const summary = {
      dryRun: !apply,
      repairMode: repair,
      scanned: companies.length,
      consistent: results.filter((result) => result.status === "consistent").length,
      ready: results.filter((result) => result.status === "ready").length,
      updated: results.filter((result) => result.status === "updated").length,
      mismatch: results.filter((result) => result.status === "mismatch").length,
      repaired: results.filter((result) => result.status === "repaired").length,
      missingSlug: results.filter((result) => result.status === "missing_slug").length,
      notFound: results.filter((result) => result.status === "not_found").length,
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
