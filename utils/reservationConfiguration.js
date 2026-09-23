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
  platformAuthoritative = false,
} = {}) => {
  const resolvedTemplateKey = normalizeReservationsTemplateKey(templateKey);
  const template = getReservationsTemplate(resolvedTemplateKey);
  return {
    templateKey: resolvedTemplateKey,
    businessType: template.businessType,
    capabilities: {
      ...NEUTRAL_RESERVATION_CAPABILITIES,
      ...(template.capabilities || {}),
      ...(platformAuthoritative
        ? {}
        : pickKnown(capabilities, Object.keys(NEUTRAL_RESERVATION_CAPABILITIES))),
    },
    terminology: {
      ...NEUTRAL_RESERVATION_TERMINOLOGY,
      ...(template.terminology || {}),
      ...(platformAuthoritative
        ? {}
        : pickKnown(terminology, RESERVATION_TERMINOLOGY_KEYS)),
    },
    bookingBehavior: {
      booking_behavior: "immediate",
      confirmation_message: "Your booking request has been received.",
      ...bookingBehavior,
    },
  };
};

export const buildReservationGovernanceContract = ({
  company = {},
  settings = {},
} = {}) => {
  const platformTemplate = isReservationsTemplate(company.reservationTemplate)
    ? company.reservationTemplate
    : null;
  const templateAuthority = platformTemplate ? "platform" : "legacy";
  const effectiveTemplateKey = normalizeReservationsTemplateKey(
    platformTemplate || settings.template_key || "restaurant",
  );
  const bookingBehavior = {};
  if (settings.booking_behavior !== undefined) {
    bookingBehavior.booking_behavior = settings.booking_behavior;
  }
  if (settings.confirmation_message !== undefined) {
    bookingBehavior.confirmation_message = settings.confirmation_message;
  }
  const resolved = resolveReservationsConfiguration({
    templateKey: effectiveTemplateKey,
    capabilities: settings.capabilities,
    terminology: settings.terminology,
    bookingBehavior,
    platformAuthoritative: Boolean(platformTemplate),
  });
  const template = getReservationsTemplate(resolved.templateKey);

  return {
    templateAuthority,
    capabilitiesManagedByPlatform: templateAuthority === "platform",
    effectiveTemplateKey: resolved.templateKey,
    effectiveTemplateLabel: template.label,
    effectiveCapabilities: resolved.capabilities,
    effectiveTerminology: resolved.terminology,
    bookingBehavior: resolved.bookingBehavior,
    confirmationMessage: resolved.bookingBehavior.confirmation_message,
  };
};

export const getReservationTemplateConfigurationDrift = ({ templateKey, settings } = {}) => {
  const expected = resolveReservationsConfiguration({
    templateKey,
    platformAuthoritative: true,
  });
  const actual = settings || {};
  const capabilitiesMatch = Object.entries(expected.capabilities).every(
    ([key, value]) => actual.capabilities?.[key] === value,
  );
  const terminologyMatch = Object.entries(expected.terminology).every(
    ([key, value]) => actual.terminology?.[key] === value,
  );
  return {
    templateKeyMatches: actual.template_key === expected.templateKey,
    capabilitiesMatch,
    terminologyMatch,
    drift: actual.template_key !== expected.templateKey || !capabilitiesMatch || !terminologyMatch,
    expected,
  };
};
