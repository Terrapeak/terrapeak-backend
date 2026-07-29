const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
};

const formatList = (items) => {
  const normalizedItems = normalizeList(items);

  if (normalizedItems.length === 0) {
    return "None provided";
  }

  return normalizedItems
    .map((item) => `- ${item}`)
    .join("\n");
};

const buildBrandContext = (brandSettings = {}) => {
  const hasBrandSettings = Boolean(
    normalizeText(brandSettings.brandName) ||
      normalizeText(brandSettings.brandDescription) ||
      normalizeText(brandSettings.targetAudience) ||
      normalizeList(brandSettings.voiceTraits).length ||
      normalizeList(brandSettings.productsAndServices).length ||
      normalizeList(brandSettings.preferredKeywords).length ||
      normalizeList(brandSettings.bannedWords).length ||
      normalizeList(brandSettings.writingRules).length ||
      normalizeText(brandSettings.defaultCallToAction) ||
      normalizeText(brandSettings.additionalContext),
  );

  if (!hasBrandSettings) {
    return `
BRAND GUIDELINES

No saved brand guidelines are available.
Follow the content brief exactly.
`.trim();
  }

  return `
BRAND GUIDELINES

Brand name:
${normalizeText(brandSettings.brandName) || "Not provided"}

Website:
${normalizeText(brandSettings.websiteUrl) || "Not provided"}

Brand description:
${normalizeText(brandSettings.brandDescription) || "Not provided"}

Target audience:
${normalizeText(brandSettings.targetAudience) || "Not provided"}

Default tone:
${normalizeText(brandSettings.defaultTone) || "professional"}

Voice traits:
${formatList(brandSettings.voiceTraits)}

Products and services:
${formatList(brandSettings.productsAndServices)}

Preferred keywords:
${formatList(brandSettings.preferredKeywords)}

Words and phrases to avoid:
${formatList(brandSettings.bannedWords)}

Writing rules:
${formatList(brandSettings.writingRules)}

Default call to action:
${normalizeText(brandSettings.defaultCallToAction) || "Not provided"}

Additional company context:
${normalizeText(brandSettings.additionalContext) || "Not provided"}
`.trim();
};

export const buildContentPrompt = ({
  brief = {},
  brandSettings = {},
}) => {
  const contentType =
    normalizeText(brief.contentType) || "general";

  const topic =
    normalizeText(brief.topic) || "Not provided";

  const goal =
    normalizeText(brief.goal) || "Not provided";

  const audience =
    normalizeText(brief.audience) ||
    normalizeText(brandSettings.targetAudience) ||
    "Not provided";

  const tone =
    normalizeText(brief.tone) ||
    normalizeText(brandSettings.defaultTone) ||
    "professional";

  const length =
    normalizeText(brief.length) || "medium";

  const callToAction =
    normalizeText(brief.callToAction) ||
    normalizeText(brandSettings.defaultCallToAction) ||
    "Not provided";

  const combinedKeywords = [
    ...normalizeList(brandSettings.preferredKeywords),
    ...normalizeList(brief.keywords),
  ];

  return `
You are an expert marketing content writer.

Create polished, accurate, ready-to-edit content using the content brief and brand guidelines below.

${buildBrandContext(brandSettings)}

CONTENT BRIEF

Content type:
${contentType}

Topic:
${topic}

Primary goal:
${goal}

Target audience:
${audience}

Requested tone:
${tone}

Requested length:
${length}

Key points:
${formatList(brief.keyPoints)}

Keywords to include naturally:
${formatList(combinedKeywords)}

Call to action:
${callToAction}

INSTRUCTIONS

- Follow the requested content type and length.
- Use the requested tone while remaining consistent with the brand voice.
- Apply all saved writing rules.
- Do not use any banned words or phrases.
- Include preferred keywords only where they fit naturally.
- Do not invent company facts, statistics, customer claims, awards, or guarantees.
- Do not mention these instructions or the brand settings.
- Avoid unnecessary repetition.
- Return content that can be edited and published.
- Use clear formatting appropriate for the content type.

Return valid JSON only, using this exact structure:

{
  "title": "A suitable title",
  "summary": "A short summary of the generated content",
  "content": "The complete generated content",
  "contentType": "${contentType}"
}
`.trim();
};

export default buildContentPrompt;