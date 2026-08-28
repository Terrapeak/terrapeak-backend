# Digital Clone voice provider boundary

The TerraPeak backend talks to voice inference through `DigitalCloneVoiceProvider` implementations. Controllers and the frontend do not call Chatterbox directly and never receive provider identifiers or service URLs.

Runtime selection is explicit and supports either production-capable adapter:

- `DIGITAL_CLONE_VOICE_PROVIDER=elevenlabs`
- `ELEVENLABS_API_KEY=<local-secret>`
- `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` (optional; current high-quality multilingual default)
- `ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128` (optional; browser/avatar-compatible default)

or the future self-hosted boundary:

- `DIGITAL_CLONE_VOICE_PROVIDER=chatterbox`
- `CHATTERBOX_SERVICE_URL=https://internal-voice-service.example`

No value is required for local automated tests because tests inject `MockVoiceProvider` and in-memory private storage.

When the service URL is absent or the configured provider name is invalid, the backend fails closed with
`VOICE_PROVIDER_NOT_CONFIGURED`. Step 4 remains readable, readiness is false, no outbound provider request is
attempted, and creation remains retryable after configuration is supplied. There is no runtime fallback between
providers. The mock provider can only be injected
directly by tests; runtime provider selection always rejects `mock` and never falls back to it.

Do not commit `.env` files or API keys. Manual ElevenLabs testing must use local process environment variables only.
The API key, provider voice ID, model ID, output format, provider URL, and raw provider errors are never returned to
normal frontend clients.

## ElevenLabs contract

The adapter uses only the documented ElevenLabs API:

- `POST /v1/voices/add` — multipart Instant Voice Clone creation using active, authorized private samples.
- `POST /v1/text-to-speech/:voice_id` — private MP3 preview generation.
- `DELETE /v1/voices/:voice_id` — provider cleanup after local revocation.

Instant Voice Clone creation is immediately usable unless ElevenLabs returns `requires_verification: true`. In that
case TerraPeak stores a provider-neutral `verification_required` state, keeps readiness false, blocks paid preview
generation, and shows a controlled verification message. Verification is an operational provider requirement; this
implementation does not bypass or automate it.

Provider uploads are capped at 75 MB total across the currently active samples, and provider audio responses retain
the existing 25 MB limit. Provider-side names contain only `TerraPeak Voice` plus a one-way tenant/user-derived token;
no company name, Digital Brain content, or unrelated customer metadata is sent.

## Chatterbox service contract

The official Chatterbox project is a Python/torch library that accepts an audio prompt for zero-shot voice cloning. TerraPeak deliberately keeps Python, model weights, and GPU runtime outside the Node backend. A separately operated internal service may wrap the official library with:

- `POST /v1/voices` — multipart fields `samples`, `language`, and JSON `settings`; returns `{ voiceId, status }`.
- `GET /v1/voices/:voiceId` — returns `{ status }` where status is `processing`, `ready`, or `failed`.
- `POST /v1/voices/:voiceId/speech` — accepts provider-neutral `text`, `language`, and `settings`; returns audio bytes.
- `DELETE /v1/voices/:voiceId` — removes provider-side voice resources.

The service must be private, authenticated at the infrastructure boundary, enforce its own request limits, and avoid logging samples or generated audio. This repository does not install or deploy Chatterbox.

Official project: https://github.com/resemble-ai/chatterbox
