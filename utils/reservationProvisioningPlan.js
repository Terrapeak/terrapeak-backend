import { resolveReservationsConfiguration } from "./reservationConfiguration.js";

export const getReservationProvisioningPlan = ({ reservationTemplate } = {}) => {
  const legacyRestaurant = reservationTemplate === undefined;
  const templateKey = legacyRestaurant
    ? "restaurant"
    : resolveReservationsConfiguration({ templateKey: reservationTemplate }).templateKey;
  const configuration = resolveReservationsConfiguration({ templateKey });

  return {
    legacyRestaurant,
    templateKey,
    businessType: configuration.businessType,
    capabilities: configuration.capabilities,
    terminology: configuration.terminology,
    restaurantCompatibility: templateKey === "restaurant",
  };
};
