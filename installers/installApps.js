import installAIAssistant from "./installAIAssistant.js";
import installReservations from "./installReservations.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";

const INSTALLERS = {
  "ai-assistant": installAIAssistant,
  reservations: installReservations,
};

export default async function installApps({
  company,
  user,
  installedApps = [],
}) {
  const results = {};

  for (const appSlug of installedApps) {
    const installer = INSTALLERS[appSlug];

    if (!installer) {
      console.log(`No installer found for app: ${appSlug}`);
      continue;
    }

    console.log(`Installing app: ${appSlug}`);

    const result = await installer({
  company,
  user,
});

results[appSlug] = result;

await CompanyAppInstallation.findOneAndUpdate(
  {
    companyId: company._id,
    appSlug,
  },
  {
    companyId: company._id,
    appSlug,
    enabled: true,
    status: "active",
    installedBy: user._id,
  },
  {
    upsert: true,
    new: true,
  }
);
  }

  return results;
}