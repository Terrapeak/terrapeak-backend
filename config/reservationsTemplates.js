export const DEFAULT_RESERVATIONS_TEMPLATE = "general";

export const RESERVATIONS_TEMPLATES = Object.freeze({
  general: {
    label: "General appointments",
    businessType: "general",
    capabilities: {
      services: true,
      teamResources: true,
      scheduledSessions: false,
      packages: false,
      guestCount: false,
    },
    terminology: {
      customerSingular: "Customer",
      customerPlural: "Customers",
      teamMemberSingular: "Team member",
      teamMemberPlural: "Team members",
      serviceSingular: "Service",
      servicePlural: "Services",
      bookingSingular: "Booking",
      bookingPlural: "Bookings",
      guestSingular: "Guest",
      guestPlural: "Guests",
    },
    fields: [],
  },
  physiotherapy: {
    label: "Physiotherapy",
    businessType: "physiotherapy",
    capabilities: {
      services: true,
      teamResources: true,
      scheduledSessions: false,
      packages: true,
      guestCount: false,
    },
    terminology: {
      customerSingular: "Patient",
      customerPlural: "Patients",
      teamMemberSingular: "Therapist",
      teamMemberPlural: "Therapists",
      serviceSingular: "Treatment",
      servicePlural: "Treatments",
      bookingSingular: "Appointment",
      bookingPlural: "Appointments",
    },
    fields: [
      ["Main concern", "textarea", null, true],
      ["Affected region", "text", null, false],
      ["First visit?", "dropdown", ["Yes", "No"], false],
      ["Preferred therapist", "text", null, false],
      ["Pain level", "dropdown", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], false],
    ],
  },
  dental: {
    label: "Dental clinic",
    businessType: "dental",
    capabilities: { services: true, teamResources: true, scheduledSessions: false, packages: false, guestCount: false },
    terminology: {
      customerSingular: "Patient", customerPlural: "Patients",
      teamMemberSingular: "Dentist", teamMemberPlural: "Dentists",
      serviceSingular: "Treatment", servicePlural: "Treatments",
      bookingSingular: "Appointment", bookingPlural: "Appointments",
    },
    fields: [
      ["Reason for visit", "textarea", null, true],
      ["Procedure", "dropdown", ["Check-up", "Cleaning", "Filling", "Extraction", "Emergency", "Other"], false],
      ["First visit?", "dropdown", ["Yes", "No"], false],
      ["Preferred dentist", "text", null, false],
    ],
  },
  salon: {
    label: "Salon / beauty",
    businessType: "salon",
    capabilities: { services: true, teamResources: true, scheduledSessions: false, packages: false, guestCount: false },
    terminology: {
      teamMemberSingular: "Stylist", teamMemberPlural: "Stylists",
      bookingSingular: "Appointment", bookingPlural: "Appointments",
    },
    fields: [
      ["Requested service", "text", null, true],
      ["Preferred stylist", "text", null, false],
      ["First visit?", "dropdown", ["Yes", "No"], false],
    ],
  },
  learning_centre: {
    label: "Learning centre",
    businessType: "learning_centre",
    capabilities: { services: true, teamResources: true, scheduledSessions: true, packages: true, guestCount: false },
    terminology: {
      customerSingular: "Student", customerPlural: "Students",
      teamMemberSingular: "Teacher", teamMemberPlural: "Teachers",
      serviceSingular: "Class", servicePlural: "Classes",
      bookingSingular: "Registration", bookingPlural: "Registrations",
    },
    fields: [
      ["Student name", "text", null, true],
      ["Age / year level", "text", null, false],
      ["Subject or programme", "text", null, true],
      ["First visit?", "dropdown", ["Yes", "No"], false],
    ],
  },
  restaurant: {
    label: "Restaurant",
    businessType: "restaurant",
    capabilities: { services: false, teamResources: false, scheduledSessions: false, packages: false, guestCount: true },
    terminology: {
      customerSingular: "Guest", customerPlural: "Guests",
      teamMemberSingular: "Team member", teamMemberPlural: "Team members",
      serviceSingular: "Reservation", servicePlural: "Reservations",
      bookingSingular: "Reservation", bookingPlural: "Reservations",
      guestSingular: "Guest", guestPlural: "Guests",
    },
    fields: [["Special requests", "textarea", null, false]],
  },
});

export const isReservationsTemplate = (value) =>
  Object.prototype.hasOwnProperty.call(RESERVATIONS_TEMPLATES, value);

export const getReservationsTemplate = (value) =>
  RESERVATIONS_TEMPLATES[value] ||
  RESERVATIONS_TEMPLATES[DEFAULT_RESERVATIONS_TEMPLATE];

export const listReservationsTemplates = () =>
  Object.entries(RESERVATIONS_TEMPLATES).map(([value, template]) => ({
    value,
    label: template.label,
    businessType: template.businessType,
  }));
