const normalizeText = (value) => String(value ?? "")
  .toLowerCase()
  .trim()
  .replace(/[\u2018\u2019']/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const optionCandidates = (option, labelKey = "name") => {
  if (typeof option === "string") return [option];
  return [
    option?.[labelKey],
    option?.value,
    option?.slug,
    option?.id,
    option?.name,
    option?.displayName,
    option?.label,
    option?.localTime,
  ].filter((value) => value !== undefined && value !== null && String(value).trim());
};

export const normalizeReservationOptionText = normalizeText;

export function resolveAiReservationOption(message, options = [], { labelKey = "name", allowPartial = true, normalize = normalizeText } = {}) {
  const value = String(message ?? "").trim();
  const normalized = normalize(value);
  if (!normalized) return { status: "none", option: null, matches: [] };

  const exactMatches = options.filter((option) => optionCandidates(option, labelKey)
    .some((candidate) => normalize(candidate) === normalized));
  if (exactMatches.length === 1) return { status: "matched", option: exactMatches[0], matches: exactMatches };
  if (exactMatches.length > 1) return { status: "ambiguous", option: null, matches: exactMatches };

  if (/^\d+$/.test(value)) {
    const index = Number.parseInt(value, 10) - 1;
    if (index >= 0 && index < options.length) return { status: "matched", option: options[index], matches: [options[index]] };
  }

  if (!allowPartial) return { status: "none", option: null, matches: [] };
  const queryTokens = normalized.split(" ").filter(Boolean);
  const partialMatches = options.filter((option) => {
    const candidateTokens = new Set(optionCandidates(option, labelKey)
      .flatMap((candidate) => normalize(candidate).split(" ")));
    return queryTokens.every((token) => candidateTokens.has(token));
  });
  if (partialMatches.length === 1) return { status: "matched", option: partialMatches[0], matches: partialMatches };
  if (partialMatches.length > 1) return { status: "ambiguous", option: null, matches: partialMatches };
  return { status: "none", option: null, matches: [] };
}

export function formatAiReservationOptions(options = [], getLabel = (option) => option?.name || option?.displayName || option?.label || String(option)) {
  return options.map((option, index) => `${index + 1}. ${getLabel(option)}`).join("\n");
}
