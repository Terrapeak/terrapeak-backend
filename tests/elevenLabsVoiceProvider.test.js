import test from "node:test";
import assert from "node:assert/strict";

import { ElevenLabsVoiceProvider, resolveVoiceProvider } from "../providers/digitalCloneVoice/index.js";
import { ELEVENLABS_MAX_SAMPLE_BYTES } from "../providers/digitalCloneVoice/elevenLabsVoiceProvider.js";

const sample = () => ({
  buffer: Buffer.from("524946462400000057415645", "hex"),
  filename: "voice.wav",
  mimeType: "audio/wav",
});

const responseError = (status, data = {}) => Object.assign(new Error("raw provider detail"), {
  response: { status, data },
});

test("ElevenLabs provider requires a key and valid required configuration", () => {
  assert.throws(
    () => new ElevenLabsVoiceProvider({ apiKey: "" }).assertConfigured(),
    (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED",
  );
  assert.throws(
    () => new ElevenLabsVoiceProvider({ apiKey: "test-key", outputFormat: "wav_unbounded" }).assertConfigured(),
    (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED",
  );
  assert.doesNotThrow(() => new ElevenLabsVoiceProvider({ apiKey: "test-key" }).assertConfigured());
});

test("runtime resolution supports ElevenLabs but still rejects mock and unknown providers", () => {
  const provider = resolveVoiceProvider("elevenlabs");
  assert.equal(provider.name, "elevenlabs");
  assert.throws(() => resolveVoiceProvider("mock"), (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED");
  assert.throws(() => resolveVoiceProvider("other"), (error) => error.code === "VOICE_PROVIDER_NOT_CONFIGURED");
});

test("IVC creation uses the documented multipart endpoint and returns a private-neutral result", async () => {
  const requests = [];
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: {
      async post(url, body, options) {
        requests.push({ url, body, options });
        return { data: { voice_id: "private-provider-id", requires_verification: false } };
      },
    },
  });
  const result = await provider.createVoice({ samples: [sample()], name: "TerraPeak Voice abc123" });
  assert.deepEqual(result, { voiceId: "private-provider-id", status: "ready" });
  assert.equal(requests[0].url, "https://api.elevenlabs.io/v1/voices/add");
  assert.equal(requests[0].options.headers["xi-api-key"], "test-key");
  assert.ok(requests[0].body instanceof FormData);
});

test("IVC verification is represented without bypassing it", async () => {
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: { async post() { return { data: { voice_id: "verify-id", requires_verification: true } }; } },
  });
  assert.deepEqual(
    await provider.createVoice({ samples: [sample()] }),
    { voiceId: "verify-id", status: "verification_required" },
  );
});

test("IVC rejects oversized sample sets before any provider request", async () => {
  let calls = 0;
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: { async post() { calls += 1; } },
  });
  await assert.rejects(
    provider.createVoice({ samples: [{ ...sample(), buffer: Buffer.alloc(ELEVENLABS_MAX_SAMPLE_BYTES + 1) }] }),
    (error) => error.code === "VOICE_SAMPLE_REJECTED",
  );
  assert.equal(calls, 0);
});

for (const [name, error, expected] of [
  ["invalid API key", responseError(401), "VOICE_PROVIDER_AUTH_FAILED"],
  ["quota exhaustion", responseError(401, { detail: "insufficient credits quota" }), "VOICE_PROVIDER_QUOTA_EXCEEDED"],
  ["rate limiting", responseError(429, { detail: "too many requests" }), "VOICE_PROVIDER_RATE_LIMITED"],
  ["sample rejection", responseError(422, { detail: "invalid audio" }), "VOICE_SAMPLE_REJECTED"],
  ["provider outage", responseError(503), "VOICE_PROVIDER_UNAVAILABLE"],
]) {
  test(`IVC maps ${name} to a sanitized TerraPeak error`, async () => {
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "test-key",
      client: { async post() { throw error; } },
    });
    await assert.rejects(
      provider.createVoice({ samples: [sample()] }),
      (caught) => caught.code === expected && !/raw provider detail/.test(caught.message),
    );
  });
}

test("IVC rejects malformed success responses", async () => {
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: { async post() { return { data: { voice_id: "" } }; } },
  });
  await assert.rejects(
    provider.createVoice({ samples: [sample()] }),
    (error) => error.code === "VOICE_PROVIDER_INVALID_RESPONSE",
  );
});

test("TTS uses the documented endpoint and translates provider-neutral settings", async () => {
  const requests = [];
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: {
      async post(url, body, options) {
        requests.push({ url, body, options });
        return { data: Buffer.from("ID3valid-audio"), headers: { "content-type": "audio/mpeg", "character-cost": "12" } };
      },
    },
  });
  const result = await provider.generateSpeech({
    voiceId: "voice/id",
    text: "Hello",
    settings: { speakingPace: "slow", expressiveness: 5 },
  });
  assert.match(requests[0].url, /\/v1\/text-to-speech\/voice%2Fid\?output_format=mp3_44100_128$/);
  assert.equal(requests[0].body.model_id, "eleven_multilingual_v2");
  assert.equal(requests[0].body.voice_settings.speed, 0.85);
  assert.equal(requests[0].body.voice_settings.style, 0.4);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.deepEqual(result.usage, { characterCost: "12" });
});

test("TTS maps timeout, voice-not-found, and malformed or oversized audio safely", async () => {
  const timeout = Object.assign(new Error("internal timeout"), { code: "ECONNABORTED" });
  for (const [failure, expected] of [[timeout, "VOICE_PROVIDER_TIMEOUT"], [responseError(404), "VOICE_NOT_FOUND"]]) {
    const provider = new ElevenLabsVoiceProvider({ apiKey: "test-key", client: { async post() { throw failure; } } });
    await assert.rejects(
      provider.generateSpeech({ voiceId: "id", text: "Hello" }),
      (error) => error.code === expected && !/internal|raw provider/.test(error.message),
    );
  }
  for (const data of [Buffer.alloc(0), Buffer.alloc(25 * 1024 * 1024 + 1)]) {
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "test-key",
      client: { async post() { return { data, headers: {} }; } },
    });
    await assert.rejects(
      provider.generateSpeech({ voiceId: "id", text: "Hello" }),
      (error) => error.code === "VOICE_PROVIDER_INVALID_RESPONSE",
    );
  }
});

test("provider cleanup uses the documented delete endpoint and sanitizes failures", async () => {
  const calls = [];
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: { async delete(url, options) { calls.push({ url, options }); return { data: { status: "ok" } }; } },
  });
  assert.deepEqual(await provider.deleteVoice({ voiceId: "voice/id" }), { deleted: true });
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/voices/voice%2Fid");

  const failing = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    client: { async delete() { throw responseError(503); } },
  });
  await assert.rejects(failing.deleteVoice({ voiceId: "id" }), (error) => error.code === "VOICE_PROVIDER_UNAVAILABLE");
});
