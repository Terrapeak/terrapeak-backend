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

export const analyzeSupportConversation = async ({ subject, messages }) => {
  if (!process.env.GEMINI_API_KEY) return null;

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
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(SUPPORT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
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

    if (!response.ok) return null;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const analysis = safeJsonParse(text);
    if (!analysis) return null;

    return {
      summary: String(analysis.summary || "").slice(0, 1200),
      category: ["api_key", "technical", "billing", "users", "apps", "general"].includes(analysis.category) ? analysis.category : "general",
      priority: ["low", "normal", "high", "urgent"].includes(analysis.priority) ? analysis.priority : "normal",
      needsHuman: Boolean(analysis.needsHuman),
      escalationReason: String(analysis.escalationReason || "").slice(0, 600),
      suggestedReply: String(analysis.suggestedReply || "").slice(0, 2500),
      suggestedAction: String(analysis.suggestedAction || "").slice(0, 600),
      confidence: Math.max(0, Math.min(1, Number(analysis.confidence) || 0)),
      model: SUPPORT_MODEL,
      analyzedAt: new Date(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
