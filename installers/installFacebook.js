import FacebookChannelConfig from "../models/facebookChannelConfig.js";

export default async function installFacebook({ company, appInstallation }) {
  const config = await FacebookChannelConfig.findOneAndUpdate(
    { companyId: company._id },
    {
      ...(appInstallation?._id
        ? { $set: { appInstallationId: appInstallation._id } }
        : {}),
      $setOnInsert: {
        companyId: company._id,
        connectionStatus: "not_connected",
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  console.log("Installed Facebook channel");

  return config;
}
