export const RESERVATION_TEMPLATE_SERVICE_DEFAULTS = Object.freeze({
  general: {
    businessType: "general",
    name: "Appointment",
    slug: "appointment",
    description: "Book an appointment.",
    durationMinutes: 60,
  },
  physiotherapy: {
    businessType: "physiotherapy",
    name: "Physiotherapy Appointment",
    slug: "physiotherapy-appointment",
    description: "Book a physiotherapy appointment.",
    durationMinutes: 60,
  },
  dental: {
    businessType: "dental",
    name: "Dental Appointment",
    slug: "dental-appointment",
    description: "Book a dental appointment.",
    durationMinutes: 60,
  },
  salon: {
    businessType: "salon",
    name: "Salon Appointment",
    slug: "salon-appointment",
    description: "Book a salon or beauty appointment.",
    durationMinutes: 60,
  },
  learning_centre: {
    businessType: "learning_centre",
    name: "Learning Session",
    slug: "learning-session",
    description: "Book a learning session.",
    durationMinutes: 60,
  },
  restaurant: {
    businessType: "restaurant",
    name: "Restaurant Reservation",
    slug: "restaurant-reservation",
    description: "Customer-facing restaurant reservations.",
    durationMinutes: 90,
  },
});

export const getReservationTemplateServiceDefaults = (templateKey) =>
  RESERVATION_TEMPLATE_SERVICE_DEFAULTS[templateKey] ||
  RESERVATION_TEMPLATE_SERVICE_DEFAULTS.general;
