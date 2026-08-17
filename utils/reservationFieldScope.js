const RESTAURANT_FIELD_LABELS = new Set([
  "occasion",
  "allergies",
  "seating preference",
]);

export const restaurantFieldsOnly = (fields = []) =>
  fields.filter((field) =>
    RESTAURANT_FIELD_LABELS.has(
      String(field?.field_label || "").trim().toLowerCase(),
    ),
  );
