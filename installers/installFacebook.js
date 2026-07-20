import FacebookChannelConfig from "../models/facebookChannelConfig.js";

export default async function installFacebook({ company }) {
  const config = await FacebookChannelConfig.findOneAndUpdate(
    { companyId: company._id },
    {
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
