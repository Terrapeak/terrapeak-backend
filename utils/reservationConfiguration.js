import {
  DEFAULT_RESERVATIONS_TEMPLATE,
  getReservationsTemplate,
  isReservationsTemplate,
} from "../config/reservationsTemplates.js";

export const RESERVATION_TERMINOLOGY_KEYS = Object.freeze([
  "customerSingular", "customerPlural", "teamMemberSingular", "teamMemberPlural",
  "serviceSingular", "servicePlural", "bookingSingular", "bookingPlural",
  "guestSingular", "guestPlural",
]);

export const NEUTRAL_RESERVATION_TERMINOLOGY = Object.freeze({
  customerSingular: "Customer", customerPlural: "Customers",
  teamMemberSingular: "Team member", teamMemberPlural: "Team members",
  serviceSingular: "Service", servicePlural: "Services",
  bookingSingular: "Booking", bookingPlural: "Bookings",
  guestSingular: "Guest", guestPlural: "Guests",
});

export const NEUTRAL_RESERVATION_CAPABILITIES = Object.freeze({
  services: true,
  teamResources: true,
  scheduledSessions: false,
  packages: false,
  guestCount: false,
});

const pickKnown = (value, keys) => Object.fromEntries(
  keys.filter((key) => value && typeof value[key] === "string" || typeof value?.[key] === "boolean")
    .map((key) => [key, value[key]]),
);

export const normalizeReservationsTemplateKey = (value) =>
  isReservationsTemplate(value) ? value : DEFAULT_RESERVATIONS_TEMPLATE;

export const resolveReservationsConfiguration = ({
  templateKey,
  capabilities = {},
  terminology = {},
  bookingBehavior = {},
} = {}) => {
  const resolvedTemplateKey = normalizeReservationsTemplateKey(templateKey);
  const template = getReservationsTemplate(resolvedTemplateKey);
  return {
    templateKey: resolvedTemplateKey,
    businessType: template.businessType,
    capabilities: {
      ...NEUTRAL_RESERVATION_CAPABILITIES,
      ...(template.capabilities || {}),
      ...pickKnown(capabilities, Object.keys(NEUTRAL_RESERVATION_CAPABILITIES)),
    },
    terminology: {
      ...NEUTRAL_RESERVATION_TERMINOLOGY,
      ...(template.terminology || {}),
      ...pickKnown(terminology, RESERVATION_TERMINOLOGY_KEYS),
    },
    bookingBehavior: {
      booking_behavior: "immediate",
      confirmation_message: "Your booking request has been received.",
      ...bookingBehavior,
    },
  };
};
