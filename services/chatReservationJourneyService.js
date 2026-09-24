const APPOINTMENT_TEMPLATES = new Set(["general", "physiotherapy", "dental", "salon"]);

export function resolveChatReservationJourney({ configuration = {}, service = null } = {}) {
  const templateKey = configuration.templateKey || "general";
  const capabilities = configuration.capabilities || {};
  const enrollmentMode = service?.enrollmentMode || service?.enrollment_mode;
  const schedulingMode = service?.schedulingMode || service?.scheduling_mode;

  if (templateKey === "restaurant" || capabilities.guestCount === true) {
    return { journeyType: "restaurant", templateKey, capabilities };
  }
  if (enrollmentMode === "cohort" || (templateKey === "learning_centre" && service?.bookingType === "cohort")) {
    return { journeyType: "cohort_enquiry", templateKey, capabilities };
  }
  if (schedulingMode === "scheduled" || capabilities.scheduledSessions === true) {
    return { journeyType: "scheduled_session", templateKey, capabilities };
  }
  if (APPOINTMENT_TEMPLATES.has(templateKey) || capabilities.services !== false) {
    return { journeyType: "appointment", templateKey, capabilities };
  }
  return { journeyType: "appointment", templateKey: "general", capabilities };
}
