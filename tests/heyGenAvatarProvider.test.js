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
  const requests = []; const events = []; const productionPage = Array.from({ length: 50 }, (_, index) => voiceFixture(index));
  const client = { async get(_url, options) {
    requests.push({ ...options.params });
    if (options.params.type === "private") return { status: 200, data: { data: [voiceFixture(0, "private")], has_more: false } };
    if (!options.params.token) return { status: 200, data: { data: productionPage, has_more: true, next_token: "opaque-test-token" } };
    return { status: 200, data: { data: [voiceFixture(50)], has_more: false } };
  } };
  const voices = await new HeyGenAvatarProvider({ apiKey: "test-key", client, logger: { info: (event) => events.push(event) } }).listVoices();
  const publicRequests = requests.filter(({ type }) => type === "public");
  assert.equal(publicRequests.length, 2);
  assert.equal(publicRequests[0].token, undefined);
  assert.equal(publicRequests[1].token, "opaque-test-token");
  assert.equal(publicRequests[1].next_token, undefined);
  assert.equal(publicRequests[1].type, "public");
  assert.equal(publicRequests[1].limit, 50);
  assert.equal(requests.filter(({ type }) => type === "private").length, 1);
  assert.equal(voices.length, 52);
  assert.deepEqual(events, []);
});

test("HeyGen voice discovery rejects malformed or non-progressing live pagination safely", async () => {
  const logger = { info() {} };
  const malformed = new HeyGenAvatarProvider({ apiKey: "test-key", logger, client: { async get() { return { data: { items: {}, has_more: false } }; } } });
  await assert.rejects(malformed.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE" && error.statusCode === 502);
  const stalled = new HeyGenAvatarProvider({ apiKey: "test-key", logger, client: { async get() { return { data: { items: [], has_more: true, next_token: "same-token" } }; } } });
  await assert.rejects(stalled.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
});

test("HeyGen voice failure diagnostics separate ownership and contain structural metadata only", async () => {
  const sensitive = {
    voice_id: "secret-provider-voice-id",
    name: "Secret Voice Name",
    language: "Secret Language",
    gender: "secret-gender",
    type: "secret-type",
    support_pause: "secret-pause-value",
    support_locale: "secret-locale-value",
    preview_audio_url: "https://private.example/secret-preview.mp3",
  };
  const allowedEventFields = ["event", "diagnosticVersion", "provider", "ownershipType", "pageNumber", "httpStatus", "topLevelKeys", "hasDataArray", "hasItemsArray", "hasVoicesArray", "dataIsArray", "itemsIsArray", "voicesIsArray", "itemCount", "hasMorePresent", "hasMoreType", "nextTokenPresent", "nextTokenType", "firstItemFieldPresence", "cursorParameterName", "cursorIncluded", "ownershipParameterIncluded", "failureStage", "paginationFailureReason"];
  for (const failingType of ["public", "private"]) {
    const events = [];
    const client = { async get(_url, options) {
      if (options.params.type !== failingType) return { status: 200, data: { items: [], has_more: false } };
      return { status: 200, data: { voices: [sensitive], has_more: null, next_token: { secret: "secret-token" }, raw_payload_secret: "do-not-log" } };
    } };
    const provider = new HeyGenAvatarProvider({ apiKey: "secret-api-key", client, logger: { info: (event) => events.push(event) } });
    await assert.rejects(provider.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]), allowedEventFields);
    assert.deepEqual(events[0], {
      event: "digital_clone_avatar_voice_discovery_diagnostic",
      diagnosticVersion: "avatar-voice-live-contract-v1",
      provider: "heygen",
      ownershipType: failingType,
      pageNumber: 1,
      httpStatus: 200,
      topLevelKeys: ["voices", "has_more", "next_token"],
      hasDataArray: false,
      hasItemsArray: false,
      hasVoicesArray: true,
      dataIsArray: false,
      itemsIsArray: false,
      voicesIsArray: true,
      itemCount: 1,
      hasMorePresent: true,
      hasMoreType: "null",
      nextTokenPresent: true,
      nextTokenType: "object",
      firstItemFieldPresence: { voice_id: true, name: true, language: true, gender: true, type: true, support_pause: true, support_locale: true, preview_audio_url: true },
      cursorParameterName: "token",
      cursorIncluded: false,
      ownershipParameterIncluded: true,
      failureStage: "BODY_SHAPE",
      paginationFailureReason: "OTHER_PAGINATION_FAILURE",
    });
    const serialized = JSON.stringify(events[0]);
    for (const value of [...Object.values(sensitive), "secret-token", "raw_payload_secret", "do-not-log", "secret-api-key"]) assert.doesNotMatch(serialized, new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("HeyGen voice diagnostics classify pagination and mapped HTTP failures before rejection", async () => {
  const paginationEvents = [];
  const paginationClient = { async get(_url, options) {
    if (options.params.type === "private") return { status: 200, data: { items: [], has_more: false } };
    return { status: 200, data: { items: [], has_more: true } };
  } };
  const paginationProvider = new HeyGenAvatarProvider({ apiKey: "test-key", client: paginationClient, logger: { info: (event) => paginationEvents.push(event) } });
  await assert.rejects(paginationProvider.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  assert.equal(paginationEvents.length, 1);
  assert.equal(paginationEvents[0].ownershipType, "public");
  assert.equal(paginationEvents[0].failureStage, "PAGINATION");
  assert.equal(paginationEvents[0].pageNumber, 1);
  assert.equal(paginationEvents[0].paginationFailureReason, "MISSING_NEXT_TOKEN");
  assert.equal(paginationEvents[0].cursorParameterName, "token");
  assert.equal(paginationEvents[0].cursorIncluded, false);
  assert.equal(paginationEvents[0].ownershipParameterIncluded, true);
  assert.equal(paginationEvents[0].nextTokenPresent, false);
  assert.equal(paginationEvents[0].nextTokenType, "undefined");

  const httpEvents = [];
  const httpClient = { async get(_url, options) {
    if (options.params.type === "public") return { status: 200, data: { items: [], has_more: false } };
    const error = new Error("sensitive provider validation text");
    error.response = { status: 422, data: { error: "sensitive_provider_code", raw_payload_secret: "secret-response-value" } };
    throw error;
  } };
  const httpProvider = new HeyGenAvatarProvider({ apiKey: "secret-api-key", client: httpClient, logger: { info: (event) => httpEvents.push(event) } });
  await assert.rejects(httpProvider.listVoices(), (error) => error.code === "AVATAR_PROVIDER_INVALID_RESPONSE");
  assert.equal(httpEvents.length, 1);
  assert.equal(httpEvents[0].ownershipType, "private");
  assert.equal(httpEvents[0].httpStatus, 422);
  assert.equal(httpEvents[0].failureStage, "BODY_SHAPE");
  assert.equal(httpEvents[0].pageNumber, 1);
  assert.equal(httpEvents[0].paginationFailureReason, "OTHER_PAGINATION_FAILURE");
  const serialized = JSON.stringify(httpEvents[0]);
  for (const sensitive of ["sensitive provider validation text", "sensitive_provider_code", "raw_payload_secret", "secret-response-value", "secret-api-key"]) assert.doesNotMatch(serialized, new RegExp(sensitive, "i"));
});

test("HeyGen voice pagination diagnostics classify every current failure without cursor values", async () => {
  const runPublicFailure = async (publicResponse) => {
    const events = []; let publicPage = 0; let privateReached = false;
    const client = { async get(_url, options) {
      if (options.params.type === "private") { privateReached = true; return { status: 200, data: { data: [], has_more: false } }; }
      publicPage += 1; return publicResponse({ pageNumber: publicPage, params: options.params });
    } };
    const provider = new HeyGenAvatarProvider({ apiKey: "test-key", client, logger: { info: (event) => events.push(event) } });
    await assert.rejects(provider.listVoices());
    assert.equal(privateReached, true);
    const event = events.find(({ ownershipType }) => ownershipType === "public");
    assert.ok(event);
    return { event, publicPage };
  };

  const missing = await runPublicFailure(() => ({ status: 200, data: { data: [], has_more: true } }));
  assert.equal(missing.event.paginationFailureReason, "MISSING_NEXT_TOKEN");
  assert.equal(missing.event.pageNumber, 1);

  const empty = await runPublicFailure(() => ({ status: 200, data: { data: [], has_more: true, next_token: "   " } }));
  assert.equal(empty.event.paginationFailureReason, "EMPTY_NEXT_TOKEN");
  assert.equal(empty.event.pageNumber, 1);

  const invalidType = await runPublicFailure(() => ({ status: 200, data: { data: [], has_more: true, next_token: null } }));
  assert.equal(invalidType.event.paginationFailureReason, "INVALID_NEXT_TOKEN_TYPE");
  assert.equal(invalidType.event.pageNumber, 1);

  const repeated = await runPublicFailure(({ pageNumber }) => ({ status: 200, data: { data: [], has_more: true, next_token: pageNumber === 1 ? "opaque-repeat-token" : "opaque-repeat-token" } }));
  assert.equal(repeated.event.paginationFailureReason, "REPEATED_NEXT_TOKEN");
  assert.equal(repeated.event.pageNumber, 2);
  assert.equal(repeated.event.cursorIncluded, true);

  const limited = await runPublicFailure(({ pageNumber }) => ({ status: 200, data: { data: [], has_more: true, next_token: `opaque-page-${pageNumber}` } }));
  assert.equal(limited.publicPage, 10);
  assert.equal(limited.event.paginationFailureReason, "PAGE_LIMIT_EXCEEDED");
  assert.equal(limited.event.pageNumber, 10);
  assert.equal(limited.event.cursorIncluded, true);

  const http = await runPublicFailure(({ pageNumber }) => {
    if (pageNumber === 1) return { status: 200, data: { data: [], has_more: true, next_token: "opaque-http-token" } };
    const error = new Error("private HTTP detail"); error.response = { status: 503, data: { secret: "private provider body" } }; throw error;
  });
  assert.equal(http.event.paginationFailureReason, "NEXT_PAGE_HTTP_FAILURE");
  assert.equal(http.event.pageNumber, 2);
  assert.equal(http.event.httpStatus, 503);

  const invalidBody = await runPublicFailure(({ pageNumber }) => pageNumber === 1
    ? { status: 200, data: { data: [], has_more: true, next_token: "opaque-body-token" } }
    : { status: 200, data: { data: [], has_more: null } });
  assert.equal(invalidBody.event.paginationFailureReason, "NEXT_PAGE_BODY_INVALID");
  assert.equal(invalidBody.event.pageNumber, 2);
  assert.equal(invalidBody.event.cursorIncluded, true);

  for (const { event } of [missing, empty, invalidType, repeated, limited, http, invalidBody]) {
    const serialized = JSON.stringify(event);
    for (const secret of ["opaque-repeat-token", "opaque-page-", "opaque-http-token", "opaque-body-token", "private HTTP detail", "private provider body"]) assert.doesNotMatch(serialized, new RegExp(secret, "i"));
  }
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
