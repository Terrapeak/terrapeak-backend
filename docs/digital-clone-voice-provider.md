# Digital Clone voice provider boundary

The TerraPeak backend talks to voice inference through `DigitalCloneVoiceProvider` implementations. Controllers and the frontend do not call Chatterbox directly and never receive provider identifiers or service URLs.

Runtime selection uses:

- `DIGITAL_CLONE_VOICE_PROVIDER=chatterbox`
- `CHATTERBOX_SERVICE_URL=https://internal-voice-service.example`

No value is required for local automated tests because tests inject `MockVoiceProvider` and in-memory private storage.

When the service URL is absent or the configured provider name is invalid, the backend fails closed with
`VOICE_PROVIDER_NOT_CONFIGURED`. Step 4 remains readable, readiness is false, no outbound provider request is
attempted, and creation remains retryable after configuration is supplied. The mock provider can only be injected
directly by tests; runtime provider selection always rejects `mock` and never falls back to it.

## Chatterbox service contract

The official Chatterbox project is a Python/torch library that accepts an audio prompt for zero-shot voice cloning. TerraPeak deliberately keeps Python, model weights, and GPU runtime outside the Node backend. A separately operated internal service may wrap the official library with:

- `POST /v1/voices` — multipart fields `samples`, `language`, and JSON `settings`; returns `{ voiceId, status }`.
- `GET /v1/voices/:voiceId` — returns `{ status }` where status is `processing`, `ready`, or `failed`.
- `POST /v1/voices/:voiceId/speech` — accepts provider-neutral `text`, `language`, and `settings`; returns audio bytes.
- `DELETE /v1/voices/:voiceId` — removes provider-side voice resources.

The service must be private, authenticated at the infrastructure boundary, enforce its own request limits, and avoid logging samples or generated audio. This repository does not install or deploy Chatterbox.

Official project: https://github.com/resemble-ai/chatterbox
