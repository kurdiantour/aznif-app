# Aznif push notification audit — 2026-09-27 (Asia/Baghdad)

No application runtime code, deployed function, secrets, schema or device rows were changed. Initial audit and existing tests completed before adding test coverage. The only outbound notification was one direct Expo send to one existing Android token. Earlier Edge requests were rejected before sending.

## Live results

Project: rcvrccnrzcennnbzrsex (kozel-domino).
Remote send-push-notification: ACTIVE, version 4, verify_jwt=false; its retrieved entrypoint and shared handler were reviewed against the local implementation.

Remote inventory: 14 active devices, all Android / production. The newest device's user had 3 active devices and was excluded. The selected user had exactly 1 active device in production.

- Device: 68016d11-9c29-4554-97d2-f87978aa3bde
- User: 2ac0334d-eda2-441e-8f82-3f8926ee81a8
- Last registration/update before test: 2026-09-26T18:46:35.556825Z
- Single-recipient guard was checked through the actual REST API before each intended send. No broadcast request was made.
- No token, installation proof or API secret is included in this report.

### Deployed Edge path: FAILED authorization

At 2026-09-26T22:15:21.4781808Z, a request with the project's current legacy service_role key and explicit userId/environment was rejected with HTTP 401. Remote logs identify version 4, request 01a0dfc9-86a2-7026-b67f-f7c14c296ac8 and a service_role JWT. A subsequent no-send probe with body {} returned the exact body {"error":"Unauthorized"} using HttpClient.

Missing authorization, a deliberately invalid bearer token and the anon key also returned 401. These are real HTTP checks, not mocks. No real authenticated ordinary-user JWT was available; that case is covered locally.

The service_role key successfully read push_devices through REST. The Edge handler, however, only accepts exact equality with its runtime SUPABASE_SERVICE_ROLE_KEY. Thus a working project server credential is incompatible with the credential accepted by this deployment. Secret-list metadata contained 64-character hexadecimal digests; the listed service-role digest did not match SHA-256 of the current project service_role API key. The same discrepancy was observed for anon metadata. No secrets were changed or exposed. The history that produced the runtime mismatch was not established.

Relevant source: supabase/functions/send-push-notification/index.ts:5 and :11.
This is the blocking defect in the full requested chain. The failed request never reached Expo; it must not be described as accepted, DeviceNotRegistered, or an Expo failure.

### Isolated Expo → FCM path: PASSED

After establishing the 401 outcome, exactly one notification was submitted directly to Expo using the selected row's token. This deliberately bypassed the broken deployed authorization and did not validate a successful end-to-end Edge invocation.

Sent at UTC: 2026-09-26T22:17:43.8767615Z
Local Baghdad time: 2026-09-27 01:17:43

Exact payload fields (token redacted):
{
  "to": "[selected Android token]",
  "title": "Aznif Push Test",
  "body": "Single-device notification audit test.",
  "sound": "default",
  "priority": "high",
  "channelId": "general",
  "ttl": 0
}

Expo /push/send: HTTP 200
{"data":[{"status":"ok","id":"01a0dfcb-b45d-73ff-b387-7770e608d43d"}]}

Expo /push/getReceipts: HTTP 200
{"data":{"01a0dfcb-b45d-73ff-b387-7770e608d43d":{"status":"ok"}}}

Verdict: Expo accepted the notification and its receipt confirmed successful handoff to FCM. No DeviceNotRegistered or provider error was returned. This does not prove the notification was displayed, sounded or read on the phone. ADB reported no attached devices.

## Audit findings and limits

1. Blocking credential mismatch: current server key is rejected by deployed authorization (live reproduction above). Location: supabase/functions/send-push-notification/index.ts:11. Fixing or redeploying was outside this audit-only scope.
2. No native single-device selector: input accepts userId/userIds, environment and cursor; the real query returns every active device of those users/environment. Location: supabase/functions/send-push-notification/index.ts:13 and _shared/push-immediate.ts:3. Sending to a user is not a guarantee of one device. The live direct send used one scalar token, so even concurrent registrations could not add recipients to that request.
3. No automatic receipt handling: the shared handler returns ticket IDs but does not retrieve receipts or persist follow-up work. DeviceNotRegistered cleanup only handles errors returned immediately in tickets. A later receipt-only invalidation would leave the row active until another mechanism deactivates it. Location: supabase/functions/_shared/push-immediate.ts:71. The receipt above was checked manually.
4. ttl=0 explicitly requests immediate delivery without retaining the message for an offline device. Location: supabase/functions/_shared/push-immediate.ts:20. This is an intentional delivery constraint, not evidence of failed FCM credentials.
5. Expo non-2xx response details are reduced to ExpoHTTP:<status>, and failed/ambiguous batches return unknown without automatic retry. Location: supabase/functions/_shared/push-immediate.ts:60. This avoids blind duplicates but loses provider error detail. Verified from code and existing network-failure tests, not induced against Expo.

## Registration, database and Android review

- platform.native.ts creates Android channel general before permission/token acquisition and requests a token using the EAS project ID. Foreground presentation enables banner/list/sound.
- app.json includes expo-notifications, defaultChannel general, package com.aznif.app and EAS project 64d23121-61ba-4fe2-8fff-39d7589ce82e.
- app.config.ts validates the Firebase file/package for Android EAS builds; eas.json separates development and production registration environments.
- devices.ts serializes registration, checks the current session user, sends installation proof and environment to push_register_device, handles revoked permission and pauses registration during logout.
- NotificationProvider is mounted in app/_layout.tsx and refreshes on authentication, foregrounding and token changes.
- Remote RLS is enabled. anon/authenticated have no table grants. Public RPC wrappers are security invoker; private implementations are security definer with empty search_path, auth.uid checks, installation proof and ownership checks. Anonymous EXECUTE is denied and authenticated EXECUTE is granted.
- Remote registration token regex was evaluated against a synthetic valid token and existing tokens: example matched; 14/14 stored tokens matched.
- No fresh registration RPC, logout, permission dialog, token rotation, app installation or physical-device display was performed on Remote. Existing rows prove stored registrations exist, not that the currently installed client matches repository source.
- FCM credentials were functionally exercised for this token through the successful Expo receipt; EAS credential configuration and the installed APK were not independently inspected.

## Repeatable local test

Run:
npm run test:notifications

Result: 31 passing tests, process exit code 0:
- 5 database tests executing the migration in local PGlite: table/RPC authorization, idempotent registration, ownership transfer proof, token theft rejection, invalid inputs, unregister and token rotation.
- 9 existing shared-handler contract tests: audience validation, authorization gate, payload, ticket errors, network ambiguity, environment, batch bounds and oversized payload.
- 4 new tests in scripts/notifications-edge.test.mjs: execute the actual transpiled Edge entrypoint together with the real shared handler; replace Deno, PostgREST and Expo transport. Verify actual authorization code, actual query filter construction, one-user/environment isolation, exact outgoing JSON, multiple devices per user and exact cleanup filters.
- 13 Jest client tests across 4 suites: mocked native token/channel flow, device registration, session protection, permission revocation, logout, provider lifecycle and Expo Go guard.

These local tests do not contact Expo or Supabase, and running the command sends no notifications. They cannot detect production runtime secret drift; the live 401 check did.

Changed files for this audit:
- scripts/notifications-edge.test.mjs (new)
- package.json (include new test in existing test:notifications command)
- docs/push-notification-audit-2026-09-27.md (this report)

Pre-existing user changes were preserved. git diff --check passed before the report was written; final verification is recorded in the task response.

## Evidence classification

| Segment | Evidence |
| --- | --- |
| Android permission → EAS Expo token | Source review + mocked native tests; no physical execution |
| Client registration → push_devices | Client mocks + real local SQL tests; remote schema/rows inspected, no live registration mutation |
| Remote sender authorization | Real HTTP: missing/invalid/anon rejected; current service_role unexpectedly rejected |
| Sender targeting and payload | Actual entrypoint executed with fake external services; live REST recipient preflight |
| Remote sender → Expo | Blocked at authorization, not successfully exercised |
| Existing token → Expo → FCM | One real direct notification; successful ticket and receipt |
| Phone display/read | Unverified; no attached device |

References:
- Expo ticket/receipt meaning and provider errors: https://docs.expo.dev/push-notifications/sending-notifications/
- Supabase runtime environment keys: https://supabase.com/docs/guides/functions/secrets


## Follow-up: dedicated sender secret deployed and verified

Completed 2026-09-27 Baghdad time. This follow-up resolves the blocking authorization finding above; the earlier audit remains a historical record.

Changes:
- send-push-notification/index.ts now reads PUSH_SEND_SECRET and accepts only Authorization: Bearer <PUSH_SEND_SECRET>.
- SUPABASE_SERVICE_ROLE_KEY is used exclusively to create the server-side database client in this function.
- Missing/empty PUSH_SEND_SECRET fails closed with 503 Authorization unavailable, before device lookup.
- A cryptographically random 32-byte (256-bit), hex-encoded secret was set in project rcvrccnrzcennnbzrsex via Supabase secrets set. Its value was never printed or committed.
- The temporary plaintext CLI env file was deleted. A Windows DPAPI encrypted SecureString backup is at C:\Users\SSD FC\AppData\Local\Aznif\push-send-secret-rcvrccnrzcennnbzrsex.xml. It is bound to the current Windows user/machine, outside the repository.
- For an authorized server-side caller on this Windows account, Import-Clixml reads the SecureString backup; callers must use this dedicated secret, not service_role. Never include it in the mobile application.
- Deployed only send-push-notification; Remote version 6, ACTIVE, verify_jwt=false confirmed by retrieving the deployed source.
- Device targeting, registration, shared payload/receipt handling and database schema were not changed.

Validation:
- npm run test:notifications: 32 tests passed (5 local database, 14 contract/entrypoint, 13 Jest).
- Updated entrypoint tests reject the actual database key, incorrect secret and malformed bearer headers; successful sends use the dedicated secret.
- Tests assert createClient still receives the database service key and missing/empty dedicated secret never falls back to that key.
- deno check --config supabase/functions/deno.json supabase/functions/send-push-notification/index.ts: passed.
- Real HTTP authorization probes: absent, incorrect, anon and service_role credentials each returned 401 Unauthorized.
- Correct dedicated secret with empty JSON returned 400 Invalid title or body, confirming authentication passed without sending.

Exactly one live send was made in this follow-up, through the deployed Edge Function (no direct Expo send):
- UTC: 2026-09-26T22:35:26.0768798Z (2026-09-27 01:35:26 Baghdad)
- User: 2ac0334d-eda2-441e-8f82-3f8926ee81a8
- Device: 68016d11-9c29-4554-97d2-f87978aa3bde
- Fresh REST preflight found exactly one active device across all environments for this user; it was Android / production.
- Payload: userId above, environment production, title "Aznif Push Test", body "Dedicated authorization test through the push function."
- Function HTTP 200:
  {"complete":true,"results":[{"deviceId":"68016d11-9c29-4554-97d2-f87978aa3bde","userId":"2ac0334d-eda2-441e-8f82-3f8926ee81a8","status":"accepted","ticketId":"01a0dfdb-ea2c-743a-8270-e912620bed89"}]}
- Manual Expo receipt lookup HTTP 200:
  {"data":{"01a0dfdb-ea2c-743a-8270-e912620bed89":{"status":"ok"}}}

This verifies dedicated authorization → deployed function → actual database lookup → Expo acceptance → FCM handoff for the selected existing token. No DeviceNotRegistered error occurred. Physical phone display/read and fresh Android registration remain unverified. Receipt automation was not added.
