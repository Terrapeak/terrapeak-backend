import { normalizeStructuredDateInput } from "./aiReservationCustomerForm.js";

const WEEKDAYS = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});

const MONTHS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
});

const MONTH_ALIASES = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 });
const naturalDateHelp = "I couldn't determine that date safely. You can say 'tomorrow', 'next Monday', '24 September', or enter YYYY-MM-DD.";
const invalidCalendarDate = "That is not a valid calendar date. Please choose a real calendar date.";

const pad = (value) => String(value).padStart(2, "0");
const formatDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const datePartsInTimezone = (instant, timezone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
    return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
  } catch {
    return null;
  }
};

const addDays = ({ year, month, day }, amount) => {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

const localWeekday = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const validTimezone = (timezone) => {
  if (!String(timezone || "").trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const result = (value) => ({ valid: true, value, message: null });
const failure = (message = naturalDateHelp) => ({ valid: false, value: null, message });

const resolveMonthDay = (month, day, current) => {
  if (!Number.isInteger(day) || day < 1) return failure(invalidCalendarDate);
  if (day > daysInMonth(current.year, month)) {
    const nextYear = current.year + 1;
    return day <= daysInMonth(nextYear, month)
      ? result(formatDate(nextYear, month, day))
      : failure(invalidCalendarDate);
  }
  const thisYear = { year: current.year, month, day };
  if (formatDate(thisYear.year, thisYear.month, thisYear.day) >= formatDate(current.year, current.month, current.day)) return result(formatDate(thisYear.year, thisYear.month, thisYear.day));
  const nextYear = current.year + 1;
  if (day > daysInMonth(nextYear, month)) return failure(invalidCalendarDate);
  return result(formatDate(nextYear, month, day));
};

export function parseNaturalReservationDate(rawValue, { timezone, now = new Date() } = {}) {
  const value = String(rawValue ?? "").trim();
  const structured = normalizeStructuredDateInput(value);
  if (structured.valid) return structured;
  if (!value) return failure(structured.message);
  if (!validTimezone(timezone)) return failure("I need the booking timezone to resolve that date safely. Please enter YYYY-MM-DD.");

  const current = datePartsInTimezone(now, timezone);
  if (!current) return failure("I couldn't determine the booking date safely. Please enter YYYY-MM-DD.");
  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  if (normalized === "today") return result(formatDate(current.year, current.month, current.day));
  if (normalized === "tomorrow") return result(formatDate(...Object.values(addDays(current, 1))));

  const nextWeekday = normalized.match(/^next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  const weekday = normalized.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextWeekday || weekday) {
    const target = WEEKDAYS[(nextWeekday || weekday)[1]];
    const currentDay = localWeekday(current);
    const nearest = (target - currentDay + 7) % 7;
    const delta = nextWeekday ? (nearest || 7) + (nearest === 0 ? 0 : 7) : nearest;
    return result(formatDate(...Object.values(addDays(current, delta))));
  }

  const dayFirst = normalized.match(/^(\d{1,2}) ([a-z]+)$/);
  const monthFirst = normalized.match(/^([a-z]+) (\d{1,2})$/);
  const month = dayFirst ? (MONTHS[dayFirst[2]] || MONTH_ALIASES[dayFirst[2]]) : (MONTHS[monthFirst?.[1]] || MONTH_ALIASES[monthFirst?.[1]]);
  const day = Number(dayFirst?.[1] || monthFirst?.[2]);
  if (month && Number.isInteger(day)) return resolveMonthDay(month, day, current);
  return failure();
}

export const RESERVATION_DATE_HELP = naturalDateHelp;
