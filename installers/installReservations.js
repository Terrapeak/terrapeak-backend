import provisionReservations from "../provisioners/reservationProvisioner.js";

export default async function installReservations({
  company,
  user,
  provisioningStore,
}) {
  if (!company.reservationBusinessSlug) {
    company.reservationBusinessSlug = company.slug;
  }

  if (!company.installedApps.includes("reservations")) {
    company.installedApps.push("reservations");
  }

  await company.save();

  const provisioningResult = await provisionReservations({
    company,
    store: provisioningStore,
  });

  const provisionedBusinessId = Number(provisioningResult.business?.id);
  if (Number.isFinite(provisionedBusinessId)) {
    company.reservationBusinessId = provisionedBusinessId;
    await company.save();
  }

  console.log("✓ Installed Reservations");

  return {
    success: true,
    app: "reservations",
    reservationBusinessId: company.reservationBusinessId || null,
    reservationBusinessSlug: company.reservationBusinessSlug,
    supabaseBusinessId: provisioningResult.business?.id,
    provisioning: provisioningResult,
  };
}
