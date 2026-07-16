const SUPPORT_MODEL = process.env.SUPPORT_AI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 12000;

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || "").match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const createSupportAiError = (code, message, status = 503) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const getSupportApiKey = () =>
  process.env.SUPPORT_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

const mapGeminiError = (status, payload) => {
  const rawMessage = String(payload?.error?.message || "").toLowerCase();

  if (status === 400 && rawMessage.includes("api key")) {
    return createSupportAiError(
      "INVALID_API_KEY",
      "Gemini rejected the support API key. Check SUPPORT_GEMINI_API_KEY in Railway.",
      400
    );
  }
  if (status === 401 || status === 403) {
    return createSupportAiError(
      "PERMISSION_DENIED",
      "Gemini denied access. Check the support API key restrictions and whether the Generative Language API is enabled.",
      status
    );
  }
  if (status === 404 || rawMessage.includes("not found") || rawMessage.includes("model")) {
    return createSupportAiError(
      "MODEL_UNAVAILABLE",
      `The support model ${SUPPORT_MODEL} is unavailable for this Gemini key.`,
      400
    );
  }
  if (status === 429 || rawMessage.includes("quota") || rawMessage.includes("rate limit")) {
    return createSupportAiError(
      "QUOTA_EXCEEDED",
      "Gemini quota or rate limit has been reached. Check the Google AI project quota and billing.",
      429
    );
  }

  return createSupportAiError(
    "GEMINI_REQUEST_FAILED",
    `Gemini rejected the analysis request with status ${status}.`,
    status >= 400 && status < 600 ? status : 503
  );
};

export const analyzeSupportConversation = async ({ subject, messages }) => {
  const apiKey = getSupportApiKey();
  if (!apiKey) {
    throw createSupportAiError(
      "MISSING_API_KEY",
      "SUPPORT_GEMINI_API_KEY is not configured on the backend.",
      503
    );
  }

  const transcript = messages
    .slice(-12)
    .map((message) => `${message.senderType}: ${message.body}`)
    .join("\n");

  const prompt = `You are an internal customer-support triage assistant for Terrapeak.
Observation mode only. Never answer the customer and never claim an action was completed.
Analyze the support request and return JSON only with these fields:
summary: concise internal summary, maximum 3 sentences
category: one of api_key, technical, billing, users, apps, general
priority: one of low, normal, high, urgent
needsHuman: boolean
escalationReason: short explanation or empty string
suggestedReply: a careful draft reply for a Terrapeak agent, maximum 140 words
suggestedAction: short internal next action or empty string
confidence: number from 0 to 1

Always require a human for API key replacement, billing or contract changes, removing users, enabling or disabling apps, data deletion, security concerns, repeated failures, or an explicit request for a person.
Do not include secrets or request an API key in chat.

Subject: ${subject}
Conversation:
${transcript}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(SUPPORT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw mapGeminiError(response.status, payload);

    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const analysis = safeJsonParse(text);
    if (!analysis) {
      throw createSupportAiError(
        "INVALID_AI_RESPONSE",
        "Gemini returned a response that could not be parsed as support analysis.",
        502
      );
    }

    return {
      summary: String(analysis.summary || "").slice(0, 1200),
      category: ["api_key", "technical", "billing", "users", "apps", "general"].includes(analysis.category)
        ? analysis.category
        : "general",
      priority: ["low", "normal", "high", "urgent"].includes(analysis.priority)
        ? analysis.priority
        : "normal",
      needsHuman: Boolean(analysis.needsHuman),
      escalationReason: String(analysis.escalationReason || "").slice(0, 600),
      suggestedReply: String(analysis.suggestedReply || "").slice(0, 2500),
      suggestedAction: String(analysis.suggestedAction || "").slice(0, 600),
      confidence: Math.max(0, Math.min(1, Number(analysis.confidence) || 0)),
      model: SUPPORT_MODEL,
      analyzedAt: new Date(),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createSupportAiError(
        "AI_TIMEOUT",
        "Gemini analysis timed out after 12 seconds.",
        504
      );
    }
    if (error?.code) throw error;
    throw createSupportAiError(
      "AI_NETWORK_ERROR",
      "The backend could not reach Gemini.",
      503
    );
  } finally {
    clearTimeout(timeout);
  }
};
