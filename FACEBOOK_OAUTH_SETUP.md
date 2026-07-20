# Facebook OAuth setup

Add these Railway variables to the backend service:

```text
META_APP_ID=<Meta App ID>
META_APP_SECRET=<Meta App Secret>
META_GRAPH_API_VERSION=<version enabled for the Meta app, for example v24.0>
META_OAUTH_REDIRECT_URI=https://terrapeak-backend-production-2866.up.railway.app/api/company/channels/facebook/oauth/callback
META_OAUTH_STATE_SECRET=<at least 32 random bytes>
FACEBOOK_TOKEN_ENCRYPTION_KEY=<exactly 32 random bytes encoded as base64, or 64 hex characters>
META_WEBHOOK_VERIFY_TOKEN=<at least 32 random bytes used only for Meta webhook verification>
FRONTEND_URL=<deployed Terrapeak frontend origin>
```

Optional:

```text
META_OAUTH_SCOPES=pages_show_list,pages_manage_metadata,pages_messaging
```

When omitted, the backend requests the three scopes shown above.

In the Meta Developer Portal:

1. Add the Facebook Login for Business/Facebook Login product for the app.
2. Enable Client OAuth Login and Web OAuth Login.
3. Add this exact Valid OAuth Redirect URI:
   `https://terrapeak-backend-production-2866.up.railway.app/api/company/channels/facebook/oauth/callback`
4. Request the `pages_show_list`, `pages_manage_metadata`, and `pages_messaging` permissions. Advanced Access/App Review is required before people without an app role can grant restricted permissions.
5. Confirm the app's allowed domains, privacy policy URL, data deletion URL, and business verification requirements before switching the app to Live mode.

Configure this webhook callback in the Meta Developer Portal:

```text
https://terrapeak-backend-production-2866.up.railway.app/api/facebook/webhook
```

Use the exact `META_WEBHOOK_VERIFY_TOKEN` value as the Verify Token. The endpoint
accepts and stores `messages`, `message_deliveries`, and `message_reads` events.
During connection verification, the backend subscribes the selected Page through
`/{page-id}/subscribed_apps` and independently verifies that the configured app is
subscribed to `messages`, `message_deliveries`, and `message_reads` before marking
the channel connected.
