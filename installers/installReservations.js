import provisionReservations from "../provisioners/reservationProvisioner.js";

export default async function installReservations({ company, user }) {
  if (!company.reservationBusinessSlug) {
    company.reservationBusinessSlug = company.slug;
  }

  if (!company.installedApps.includes("reservations")) {
    company.installedApps.push("reservations");
  }

  await company.save();

  const provisioningResult = await provisionReservations({
    company,
  });

  console.log("✓ Installed Reservations");

  return {
    success: true,
    app: "reservations",
    reservationBusinessSlug: company.reservationBusinessSlug,
    supabaseBusinessId: provisioningResult.business?.id,
    provisioning: provisioningResult,
  };
}