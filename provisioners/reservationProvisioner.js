import {
  createOrGetReservationBusiness,
  createOrUpdateBusinessProfile,
  createOrUpdateRestaurantSettings,
  createOrUpdateRestaurantBranding,
} from "../utils/reservationService.js";

export default async function provisionReservations({ company }) {
  const business = await createOrGetReservationBusiness({
    businessName: company.displayName,
    businessSlug: company.reservationBusinessSlug || company.slug,
  });

  const profile = await createOrUpdateBusinessProfile({
    businessId: business.id,
    businessName: company.displayName,
    referencePrefix: company.referencePrefix,
  });

  const settings = await createOrUpdateRestaurantSettings({
    businessId: business.id,
  });

  const branding = await createOrUpdateRestaurantBranding({
    businessId: business.id,
    restaurantName: company.displayName,
  });

  return {
    success: true,
    business,
    profile,
    settings,
    branding,
  };
}