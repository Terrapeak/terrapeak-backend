import installAIAssistant from "./installAIAssistant.js";
import installReservations from "./installReservations.js";
import installFacebook from "./installFacebook.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";

const INSTALLERS = {
  "ai-assistant": installAIAssistant,
  reservations: installReservations,
  facebook: installFacebook,
};

export const getInstallerSlugs = () => Object.keys(INSTALLERS);

export const hasAppInstaller = (appSlug) => Boolean(INSTALLERS[appSlug]);

export default async function installApps({
  company,
  user,
  installedBy = user,
  installedApps = [],
}) {
  const results = {};
  let legacyAppsChanged = false;

  for (const appSlug of new Set(installedApps)) {
    const installer = INSTALLERS[appSlug];

    if (!installer) {
      console.log(`No installer found for app: ${appSlug}`);
      continue;
    }

    console.log(`Installing app: ${appSlug}`);

    const pendingInstallation =
      await CompanyAppInstallation.findOneAndUpdate(
        {
          companyId: company._id,
          appSlug,
        },
        {
          $setOnInsert: {
            companyId: company._id,
            appSlug,
            enabled: false,
            status: "pending",
            installedBy: installedBy._id,
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

    const result = await installer({
      company,
      user,
      appInstallation: pendingInstallation,
    });

    await CompanyAppInstallation.findOneAndUpdate(
      {
        companyId: company._id,
        appSlug,
      },
      {
        $set: {
          enabled: true,
          status: "active",
          installedBy: installedBy._id,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    results[appSlug] = result;

    if (!(company.installedApps || []).includes(appSlug)) {
      company.installedApps = [...(company.installedApps || []), appSlug];
      legacyAppsChanged = true;
    }
  }

  if (legacyAppsChanged) {
    await company.save();
  }

  return results;
}
