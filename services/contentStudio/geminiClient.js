const DEFAULT_MODEL =
  process.env.CONTENT_STUDIO_AI_MODEL || "gemini-2.5-flash";

const REQUEST_TIMEOUT_MS = 30000;

const createAiError = (code, message, statusCode = 503) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const getApiKey = () =>
  process.env.CONTENT_STUDIO_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY;

const mapGeminiError = (status, payload) => {
  const providerMessage = String(payload?.error?.message || "").toLowerCase();

  if (
    status === 400 &&
    (providerMessage.includes("api key") ||
      providerMessage.includes("api_key"))
  ) {
    return createAiError(
      "INVALID_AI_API_KEY",
      "The Content Studio AI API key is invalid.",
      500
    );
  }

  if (status === 401 || status === 403) {
    return createAiError(
      "AI_PERMISSION_DENIED",
      "The AI provider denied access to Content Studio.",
      503
    );
  }

  if (
    status === 404 ||
    providerMessage.includes("model") ||
    providerMessage.includes("not found")
  ) {
    return createAiError(
      "AI_MODEL_UNAVAILABLE",
      `The Content Studio model ${DEFAULT_MODEL} is unavailable.`,
      503
    );
  }

  if (
    status === 429 ||
    providerMessage.includes("quota") ||
    providerMessage.includes("rate limit")
  ) {
    return createAiError(
      "AI_RATE_LIMITED",
      "Content generation is temporarily rate-limited. Please try again shortly.",
      429
    );
  }

  return createAiError(
    "AI_REQUEST_FAILED",
    "The AI provider could not generate the requested content.",
    status >= 400 && status < 600 ? status : 503
  );
};

export const generateWithGemini = async ({
  prompt,
  temperature = 0.7,
  maxOutputTokens = 4096,
}) => {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw createAiError(
      "MISSING_AI_API_KEY",
      "CONTENT_STUDIO_GEMINI_API_KEY or GEMINI_API_KEY is not configured.",
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      `${encodeURIComponent(DEFAULT_MODEL)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw mapGeminiError(response.status, payload);
    }

    const text = (payload?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || "")
      .join("")
      .trim();

    if (!text) {
      throw createAiError(
        "EMPTY_AI_RESPONSE",
        "The AI provider returned an empty response.",
        502
      );
    }

    return {
      text,
      model: DEFAULT_MODEL,
      usage: payload?.usageMetadata || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAiError(
        "AI_TIMEOUT",
        "Content generation timed out. Please try again.",
        504
      );
    }

    if (error?.code) {
      throw error;
    }

    throw createAiError(
      "AI_NETWORK_ERROR",
      "The backend could not reach the AI provider.",
      503
    );
  } finally {
    clearTimeout(timeout);
  }
};