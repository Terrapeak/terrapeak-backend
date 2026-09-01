import test from "node:test";
import assert from "node:assert/strict";
import HeyGenAvatarProvider, { mapHeyGenError } from "../providers/digitalCloneAvatar/heyGenAvatarProvider.js";
import { resolveAvatarProvider } from "../providers/digitalCloneAvatar/index.js";

const voiceFixture = (index, type = "public") => ({ voice_id: `${type}-voice-${index}`, name: `${type} voice ${index}`, language: "English", gender: "neutral", type, support_pause: true, support_locale: true, preview_audio_url: `https://private.example/${type}-${index}.mp3` });

test("runtime provider fails closed and never selects mock", () => {
  assert.throws(() => resolveAvatarProvider("mock"), (error) => error.code === "AVATAR_PROVIDER_NOT_CONFIGURED");
  assert.throws(() => new HeyGenAvatarProvider({ apiKey: "" }).assertConfigured(), (error) => error.code === "AVATAR_PROVIDER_NOT_CONFIGURED");
});

test("HeyGen discovery uses private v3 groups and looks and filters readiness", async () => {
  const requests = [];
  const client = { async get(url, options) {
    requests.push({ url, options });
    if (url.endsWith("/v3/avatars")) return { data: { items: [{ id: "group-1", name: "Private User", status: "completed", consent_status: null }], has_more: false } };
    return { data: { items: [
      { id: "look-ready", group_id: "group-1", name: "Portrait", status: "completed", avatar_type: "photo_avatar", preferred_orientation: "portrait", default_voice_id: "voice-1", image_width: 720, image_height: 1280, supported_api_engines: ["avatar_v"] },
      { id: "look-training", group_id: "group-1", name: "Training", status: "training", supported_api_engines: ["avatar_v"] },
      { id: "look-no-voice", group_id: "group-1", name: "No voice", status: "completed", avatar_type: "digital_twin", supported_api_engines: ["avatar_v"] },
      { id: "photo-no-voice", group_id: "group-1", name: "Photo no voice", status: "completed", avatar_type: "photo_avatar", supported_api_engines: ["avatar_iv"] },
    ], has_more: false } };
  } };
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client });
  const avatars = await provider.listAvatars();
  assert.deepEqual(requests.map(({ url }) => url), ["https://api.heygen.com/v3/avatars", "https://api.heygen.com/v3/avatars/looks"]);
  assert.ok(requests.every(({ options }) => options.params.ownership === "private" && options.headers["x-api-key"] === "test-key"));
  assert.equal(avatars[0].ready, true);
  assert.equal(avatars[0].avatarType, "photo-avatar");
  assert.equal(avatars[0].orientation, "portrait");
  assert.equal(avatars[1].ready, false);
  assert.equal(avatars[2].ready, true);
  assert.equal(avatars[2].avatarType, "digital-twin");
  assert.deepEqual(avatars[2].readinessReasons, []);
  assert.equal(avatars[3].ready, true);
  assert.equal(avatars[3].avatarType, "photo-avatar");
});

test("HeyGen accepts production groups with omitted readiness metadata for photo and digital twin looks", async () => {
  const groups = [
    { id: "test-photo-group" },
    { id: "test-twin-group" },
  ];
  const looks = [
    { id: "test-photo-look", group_id: "test-photo-group", avatar_type: "photo_avatar", status: "completed", supported_api_engines: ["avatar_v", "avatar_iv", "avatar_iii"] },
    { id: "test-twin-look", group_id: "test-twin-group", avatar_type: "digital_twin", status: "completed", supported_api_engines: ["avatar_v", "avatar_iv", "avatar_iii"] },
  ];
  const client = { async get(url) { return { data: { items: url.endsWith("/v3/avatars") ? groups : looks, has_more: false } }; } };
  const avatars = await new HeyGenAvatarProvider({ apiKey: "test-key", client }).listAvatars();
  assert.deepEqual(avatars.map(({ ready }) => ready), [true, true]);
  assert.deepEqual(avatars.map(({ avatarType }) => avatarType), ["photo-avatar", "digital-twin"]);
  assert.deepEqual(avatars.map(({ readinessReasons }) => readinessReasons), [[], []]);
  assert.ok(avatars.every(({ defaultVoiceRef }) => defaultVoiceRef === ""));
});

test("HeyGen group metadata is optional but explicit non-ready values and invalid looks fail closed", async () => {
  const groups = [
    { id: "null-metadata", status: null, consent_status: null },
    { id: "missing-status", consent_status: "approved" },
    { id: "missing-consent", status: "completed" },
    { id: "completed-approved", status: "completed", consent_status: "approved" },
    { id: "completed-consent", status: "completed", consent_status: "completed" },
    { id: "pending", status: "pending", consent_status: "approved" },
    { id: "failed", status: "failed", consent_status: "approved" },
    { id: "pending-consent", status: "completed", consent_status: "pending" },
    { id: "denied-consent", status: "completed", consent_status: "denied" },
    { id: "invalid-look", status: "completed", consent_status: "approved" },
  ];
  const looks = [
    { id: "null-look", group_id: "null-metadata", status: "completed", supported_api_engines: ["avatar_v"] },
    { id: "missing-status-look", group_id: "missing-status", status: "completed", supported_api_engines: ["avatar_v"] },
    { id: "missing-consent-look", group_id: "missing-consent", status: "completed", supported_api_engines: ["avatar_iv"] },
    { id: "approved-look", group_id: "completed-approved", status: "completed", supported_api_engines: ["avatar_iv"] },
    { id: "completed-consent-look", group_id: "completed-consent", status: "completed", supported_api_engines: ["avatar_v"] },
    { id: "pending-look", group_id: "pending", status: "completed", supported_api_engines: ["avatar_v"] },
    { id: "failed-look", group_id: "failed", status: "completed", supported_api_engines: ["avatar_v"] },
    { id: "pending-consent-look", group_id: "pending-consent", status: "completed", supported_api_engines: ["avatar_iv"] },
    { id: "denied-consent-look", group_id: "denied-consent", status: "completed", supported_api_engines: ["avatar_iv"] },
    { id: "processing-look", group_id: "invalid-look", status: "processing", supported_api_engines: ["avatar_v"] },
    { id: "missing-engines-look", group_id: "invalid-look", status: "completed" },
    { id: "unsupported-look", group_id: "invalid-look", status: "completed", supported_api_engines: ["avatar_iii"] },
    { id: "orphan-look", group_id: "orphan", status: "completed", supported_api_engines: ["avatar_iv"] },
  ];
  const client = { async get(url) { return { data: { data: url.endsWith("/v3/avatars") ? groups : looks, has_more: false } }; } };
  const avatars = await new HeyGenAvatarProvider({ apiKey: "test-key", client }).listAvatars();
  assert.deepEqual(avatars.map((avatar) => avatar.ready), [true, true, true, true, true, false, false, false, false, false, false, false, false]);
  assert.deepEqual(avatars.map((avatar) => avatar.readinessReasons[0] || null), [null, null, null, null, null, "GROUP_STATUS_INVALID", "GROUP_STATUS_INVALID", "CONSENT_INVALID", "CONSENT_INVALID", "LOOK_STATUS_INVALID", "SUPPORTED_ENGINES_MISSING", "UNSUPPORTED_ENGINE", "GROUP_NOT_FOUND"]);
});

test("HeyGen voice discovery accepts live items envelopes, paginates public voices, and deduplicates private voices", async () => {
  const requests = [];
  const client = { async get(url, options) {
    requests.push({ url, options });
    if (options.params.type === "public" && !options.params.token) return { data: { items: [{ voice_id: "public-one", name: "Annie - Lifelike", language: "English", gender: "female", type: "public" }], has_more: true, next_token: "public-page-two" } };
    if (options.params.type === "public") return { data: { items: [{ voice_id: "shared-voice", name: "Shared public", language: "English", gender: "male", type: "public" }], has_more: false } };
    return { data: { items: [{ voice_id: "shared-voice", name: "Terrapeak Group", language: "English", gender: "male", type: "private" }, { voice_id: "private-only", name: "Private narrator", language: "English", gender: "female", type: "private", preview_audio_url: "https://files.heygen.ai/private.mp3" }], has_more: false } };
  } };
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client });
  const voices = await provider.listVoices();
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url }) => url === "https://api.heygen.com/v3/voices"));
  assert.ok(requests.some(({ options }) => options.params.type === "public" && options.params.token === "public-page-two"));
  assert.equal(voices.length, 3);
  assert.equal(voices.find((voice) => voice.voiceRef === "shared-voice").voiceType, "private");
  assert.ok(voices.every((voice) => voice.ready && !("previewAudioUrl" in voice)));
});

test("HeyGen voice pagination attempts page two with the current token parameter and accepts a terminal data page", async () => {
  const requests = []; const productionPage = Array.from({ length: 50 }, (_, index) => voiceFixture(index));
  const client = { async get(_url, options) {
    requests.push({ ...options.params });
    if (options.params.type === "private") return { status: 200, data: { data: [voiceFixture(0, "private")], has_more: false } };
    if (!options.params.token) return { status: 200, data: { data: productionPage, has_more: true, next_token: "opaque-test-token" } };
    return { status: 200, data: { data: [voiceFixture(50)], has_more: false } };
  } };
  const voices = await new HeyGenAvatarProvider({ apiKey: "test-key", client }).listVoices();
  const publicRequests = requests.filter(({ type }) => type === "public");
  assert.equal(publicRequests.length, 2);
  assert.equal(publicRequests[0].token, undefined);
  assert.equal(publicRequests[1].token, "opaque-test-token");
  assert.equal(publicRequests[1].next_token, undefined);
  assert.equal(publicRequests[1].type, "public");
  assert.equal(publicRequests[1].limit, 50);
  assert.equal(requests.filter(({ type }) => type === "private").length, 1);
  assert.equal(voices.length, 52);
});

test("HeyGen voice discovery rejects malformed or non-progressing live pagination safely", async () => {
  const malformed = new HeyGenAvatarProvider({ apiKey: "test-key", client: { async get() { return { data: { items: {}, has_more: false } }; } } });
  await assert.rejects(malformed.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE" && error.statusCode === 502);
  const stalled = new HeyGenAvatarProvider({ apiKey: "test-key", client: { async get() { return { data: { items: [], has_more: true, next_token: "same-token" } }; } } });
  await assert.rejects(stalled.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  for (const next_token of [undefined, "", "   ", null]) {
    const invalidCursor = new HeyGenAvatarProvider({ apiKey: "test-key", client: { async get() { return { data: { data: [], has_more: true, ...(next_token !== undefined ? { next_token } : {}) } }; } } });
    await assert.rejects(invalidCursor.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  }
});

test("HeyGen public voice pagination succeeds beyond the former ten-page limit", async () => {
  let publicPage = 0; const requests = [];
  const client = { async get(_url, options) {
    requests.push({ ...options.params });
    if (options.params.type === "private") return { data: { data: [voiceFixture(0, "private")], has_more: false } };
    publicPage += 1; const hasMore = publicPage < 11;
    return { data: { data: [voiceFixture(publicPage)], has_more: hasMore, ...(hasMore ? { next_token: `public-page-${publicPage + 1}` } : {}) } };
  } };
  const voices = await new HeyGenAvatarProvider({ apiKey: "test-key", client }).listVoices();
  const publicRequests = requests.filter(({ type }) => type === "public");
  assert.equal(publicRequests.length, 11);
  assert.equal(publicRequests[10].token, "public-page-11");
  assert.ok(publicRequests.every(({ type, limit }) => type === "public" && limit === 50));
  assert.equal(requests.filter(({ type }) => type === "private").length, 1);
  assert.equal(voices.length, 12);
});

test("HeyGen voice pagination follows has_more through twenty valid pages", async () => {
  let publicPage = 0; const publicRequests = [];
  const client = { async get(_url, options) {
    if (options.params.type === "private") return { data: { items: [voiceFixture(0, "private")], has_more: false } };
    publicRequests.push({ ...options.params }); publicPage += 1; const hasMore = publicPage < 20;
    return { data: { items: [voiceFixture(publicPage)], has_more: hasMore, ...(hasMore ? { next_token: `large-page-${publicPage + 1}` } : {}) } };
  } };
  const voices = await new HeyGenAvatarProvider({ apiKey: "test-key", client }).listVoices();
  assert.equal(publicRequests.length, 20);
  assert.equal(publicRequests[19].token, "large-page-20");
  assert.ok(publicRequests.every(({ type, limit }) => type === "public" && limit === 50));
  assert.equal(voices.length, 21);
});

test("HeyGen voice pagination emergency ceiling stops unique-cursor runaway responses", async () => {
  let publicPage = 0;
  const client = { async get(_url, options) {
    if (options.params.type === "private") return { data: { data: [], has_more: false } };
    publicPage += 1;
    return { data: { data: [], has_more: true, next_token: `runaway-page-${publicPage + 1}` } };
  } };
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client });
  await assert.rejects(provider.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  assert.equal(publicPage, 100);
});

test("HeyGen video creation uses explicit selected voice and no callback or audio URL", async () => {
  let request;
  const client = { async post(url, body, options) { request = { url, body, options }; return { data: { data: { video_id: "video-1" } } }; } };
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client });
  const result = await provider.createVideo({ avatar: { lookRef: "look-1", supportedCapabilities: ["avatar_v"] }, voice: { voiceRef: "voice-1" }, script: "Approved words", aspectRatio: "9:16", resolution: "720p", captions: true, background: "dark", idempotencyKey: "request-1" });
  assert.deepEqual(result, { jobRef: "video-1", status: "processing" });
  assert.equal(request.url, "https://api.heygen.com/v3/videos");
  assert.equal(request.body.avatar_id, "look-1");
  assert.equal(request.body.script, "Approved words");
  assert.equal(request.body.engine.type, "avatar_v");
  assert.deepEqual(request.body.caption, { file_format: "srt", style: "default" });
  assert.equal(request.body.audio_url, undefined);
  assert.equal(request.body.voice_id, "voice-1");
  assert.equal(request.body.callback_url, undefined);
  assert.equal(request.options.headers["Idempotency-Key"], "request-1");
});

test("HeyGen video generation uses the look ID, never the group ID, for photo avatars and digital twins", async () => {
  const requests = [];
  const client = { async post(url, body) { requests.push({ url, body }); return { data: { data: { video_id: `video-${requests.length}` } } }; } };
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client });
  for (const [avatarType, groupRef, lookRef] of [["photo-avatar", "photo-group", "photo-look"], ["digital-twin", "twin-group", "twin-look"]]) {
    await provider.createVideo({ avatar: { avatarType, groupRef, lookRef, supportedCapabilities: ["avatar_v"] }, voice: { voiceRef: "voice-1" }, script: "Approved words", aspectRatio: "16:9", resolution: "1080p", captions: false, background: "default", idempotencyKey: `${avatarType}-request` });
  }
  assert.deepEqual(requests.map(({ body }) => body.avatar_id), ["photo-look", "twin-look"]);
  assert.ok(requests.every(({ body }) => !Object.values(body).includes("photo-group") && !Object.values(body).includes("twin-group")));
});

test("HeyGen status maps processing, completion, and failure without leaking response details", async () => {
  const responses = [
    { data: { data: { status: "processing" } } },
    { data: { data: { status: "completed", video_url: "https://files.heygen.ai/result.mp4", duration: 9 } } },
    { data: { data: { status: "failed", failure_code: "render_failed" } } },
  ];
  const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client: { async get() { return responses.shift(); } } });
  assert.deepEqual(await provider.getVideoStatus({ jobRef: "one" }), { status: "processing" });
  assert.deepEqual(await provider.getVideoStatus({ jobRef: "two" }), { status: "completed", resultUrl: "https://files.heygen.ai/result.mp4", durationSeconds: 9 });
  assert.deepEqual(await provider.getVideoStatus({ jobRef: "three" }), { status: "failed", failureCode: "render_failed" });
});

test("HeyGen errors map to stable TerraPeak codes", () => {
  const cases = [[401, "AVATAR_PROVIDER_AUTH_FAILED"], [402, "AVATAR_PROVIDER_QUOTA_EXCEEDED"], [429, "AVATAR_PROVIDER_RATE_LIMITED"], [503, "AVATAR_PROVIDER_UNAVAILABLE"]];
  for (const [status, code] of cases) {
    const mapped = mapHeyGenError({ response: { status, data: { error: { message: "provider secret detail" } } } });
    assert.equal(mapped.code, code);
    assert.doesNotMatch(mapped.message, /secret detail/);
  }
});
