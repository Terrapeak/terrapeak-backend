export const DEFAULT_RESERVATIONS_TEMPLATE = "general";

export const RESERVATIONS_TEMPLATES = Object.freeze({
  general: { label: "General appointments", businessType: "general" },
  physiotherapy: { label: "Physiotherapy", businessType: "physiotherapy" },
  dental: { label: "Dental clinic", businessType: "dental" },
  salon: { label: "Salon / beauty", businessType: "salon" },
  learning_centre: { label: "Learning centre", businessType: "learning_centre" },
  restaurant: { label: "Restaurant", businessType: "restaurant" },
});

export const isReservationsTemplate = (value) =>
  Object.prototype.hasOwnProperty.call(RESERVATIONS_TEMPLATES, value);

export const listReservationsTemplates = () =>
  Object.entries(RESERVATIONS_TEMPLATES).map(([value, template]) => ({
    value,
    label: template.label,
    businessType: template.businessType,
  }));
