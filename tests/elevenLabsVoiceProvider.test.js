import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import axios from "axios";

import { ElevenLabsVoiceProvider, resolveVoiceProvider } from "../providers/digitalCloneVoice/index.js";
import {
  ELEVENLABS_MAX_SAMPLE_BYTES,
  mapElevenLabsProviderError,
  safeProviderDiagnostic,
} from "../providers/digitalCloneVoice/elevenLabsVoiceProvider.js";

const sample = () => ({
  buffer: Buffer.from("524946462400000057415645", "hex"),
  filename: "voice.wav",
  mimeType: "audio/wav",
});

const responseError = (status, data = {}) => Object.assign(new Error("raw provider detail"), {
  response: { status, data, headers: { "request-id": "req_safe-123" } },
});

const silentLogger = { error() {} };

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
    logger: silentLogger,
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
  assert.equal(requests[0].options.headers["content-type"], undefined);
  assert.equal(requests[0].options.headers["Content-Type"], undefined);
  assert.ok(requests[0].body instanceof FormData);
  const fields = [...requests[0].body.entries()];
  assert.deepEqual(fields.map(([key]) => key), ["name", "remove_background_noise", "files"]);
  assert.equal(fields[0][1], "TerraPeak Voice abc123");
  assert.equal(fields[1][1], "false");
  assert.equal(fields[2][1].name, "voice.wav");
  assert.equal(fields[2][1].type, "audio/wav");
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
  ["invalid API key", responseError(401, { detail: { type: "authentication_error", code: "invalid_api_key" } }), "VOICE_PROVIDER_AUTH_FAILED"],
  ["quota exhaustion", responseError(402, { detail: { type: "payment_required", code: "insufficient_credits" } }), "VOICE_PROVIDER_QUOTA_EXCEEDED"],
  ["plan restriction", responseError(403, { detail: { type: "authorization_error", code: "feature_not_available" } }), "VOICE_PROVIDER_PLAN_REQUIRED"],
  ["generic authorization failure", responseError(403, { detail: { type: "authorization_error" } }), "VOICE_PROVIDER_AUTH_FAILED"],
  ["rate limiting", responseError(429, { detail: { type: "rate_limit_error", code: "rate_limit_exceeded" } }), "VOICE_PROVIDER_RATE_LIMITED"],
  ["documented sample rejection", responseError(422, { detail: { type: "validation_error", code: "invalid_audio" } }), "VOICE_SAMPLE_REJECTED"],
  ["generic validation failure", responseError(422, { detail: { type: "validation_error", code: "invalid_parameters" } }), "VOICE_PROVIDER_INVALID_REQUEST"],
  ["bad multipart or parameters", responseError(400, { detail: { type: "invalid_request", code: "invalid_content_type" } }), "VOICE_PROVIDER_INVALID_REQUEST"],
  ["provider conflict", responseError(409, { detail: { type: "conflict", code: "voice_already_exists" } }), "VOICE_PROVIDER_INVALID_REQUEST"],
  ["provider outage", responseError(503), "VOICE_PROVIDER_UNAVAILABLE"],
  ["non-JSON provider response", responseError(400, "<html>upstream error</html>"), "VOICE_PROVIDER_INVALID_REQUEST"],
]) {
  test(`IVC maps ${name} to a sanitized TerraPeak error`, async () => {
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "test-key",
      logger: silentLogger,
      client: { async post() { throw error; } },
    });
    await assert.rejects(
      provider.createVoice({ samples: [sample()] }),
      (caught) => caught.code === expected && !/raw provider detail/.test(caught.message),
    );
  });
}

test("IVC forwards representative WebM/Opus bytes as repeated files fields without changing them", async () => {
  const webm = Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.from("representative-opus-payload")]);
  let submittedBody;
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "test-key",
    logger: silentLogger,
    client: { async post(_url, body) {
      submittedBody = body;
      return { data: { voice_id: "voice-id", requires_verification: false } };
    } },
  });
  await provider.createVoice({
    name: "WebM voice",
    samples: [
      { buffer: webm, filename: "sample-one.webm", mimeType: "audio/webm" },
      { buffer: webm, filename: "sample-two.webm", mimeType: "audio/webm" },
    ],
  });
  const fields = [...submittedBody.entries()];
  assert.deepEqual(fields.map(([key]) => key), ["name", "remove_background_noise", "files", "files"]);
  assert.equal(fields.some(([key]) => key === "files[]"), false);
  for (const [, file] of fields.slice(2)) {
    assert.equal(file.type, "audio/webm");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), webm);
  }
});

test("Axios generates the multipart boundary and serializes repeated WebM files", async () => {
  let received;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = { headers: request.headers, body: Buffer.concat(chunks) };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ voice_id: "local-only", requires_verification: false }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "test-key",
      logger: silentLogger,
      client: {
        post(_providerUrl, body, options) {
          return axios.post(`http://127.0.0.1:${port}/capture`, body, options);
        },
      },
    });
    const webm = Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.from("local-webm")]);
    await provider.createVoice({
      samples: [
        { buffer: webm, filename: "one.webm", mimeType: "audio/webm" },
        { buffer: webm, filename: "two.webm", mimeType: "audio/webm" },
      ],
    });
    assert.match(received.headers["content-type"], /^multipart\/form-data; boundary=/);
    const serialized = received.body.toString("latin1");
    assert.equal((serialized.match(/name="files"/g) || []).length, 2);
    assert.equal(serialized.includes('name="files[]"'), false);
    assert.match(serialized, /filename="one\.webm"/);
    assert.match(serialized, /Content-Type: audio\/webm/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("safe diagnostics accept only structured allowlisted tokens and request IDs", () => {
  assert.deepEqual(
    safeProviderDiagnostic(responseError(422, {
      detail: {
        type: "validation_error",
        status: "invalid_audio_format",
        request_id: "req_structured-456",
        message: "secret raw provider explanation",
      },
    })),
    {
      httpStatus: 422,
      providerErrorType: "validation_error",
      providerErrorCode: "invalid_audio_format",
      requestId: "req_structured-456",
    },
  );
  const unsafe = safeProviderDiagnostic(responseError(400, {
    detail: { type: "bad token with spaces", code: "secret:key=value", request_id: "unsafe request id" },
  }));
  assert.equal(unsafe.providerErrorType, "unknown");
  assert.equal(unsafe.providerErrorCode, "unknown");
  assert.equal(unsafe.requestId, "req_safe-123");
});

test("provider failure logging is structured, bounded, and excludes secrets and raw payloads", async () => {
  const entries = [];
  const provider = new ElevenLabsVoiceProvider({
    apiKey: "super-secret-key",
    logger: { error(entry) { entries.push(entry); } },
    client: { async post() {
      throw responseError(422, {
        detail: {
          type: "validation_error",
          code: "invalid_audio_format",
          message: "raw payload includes private-provider-id and super-secret-key",
        },
      });
    } },
  });
  await assert.rejects(provider.createVoice({ samples: [sample()] }), { code: "VOICE_SAMPLE_REJECTED" });
  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]).sort(), [
    "event", "httpStatus", "operation", "provider", "providerErrorCode", "providerErrorType", "requestId",
    "sampleCount", "sampleExtensions", "sampleMimeTypes", "sanitizedProviderMessage", "terrapeakCode", "totalBytes",
  ].sort());
  assert.equal(entries[0].providerErrorCode, "invalid_audio_format");
  assert.equal(entries[0].sampleCount, 1);
  assert.deepEqual(entries[0].sampleMimeTypes, ["audio/wav"]);
  assert.deepEqual(entries[0].sampleExtensions, [".wav"]);
  const serialized = JSON.stringify(entries[0]);
  assert.doesNotMatch(serialized, /super-secret|private-provider|raw payload|xi-api-key/i);
});

test("error mapping handles timeouts directly and never exposes raw provider text", () => {
  const timeout = Object.assign(new Error("socket details"), { code: "ETIMEDOUT" });
  const mapped = mapElevenLabsProviderError(timeout, "create");
  assert.equal(mapped.code, "VOICE_PROVIDER_TIMEOUT");
  assert.doesNotMatch(mapped.message, /socket details/);
});

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
