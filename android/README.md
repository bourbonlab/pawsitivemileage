# PawsitiveMileage for Android

Native Android app (Kotlin, Jetpack Compose) for PawsitiveMileage, issue #28. It talks to the same `/v1` API as the web app and `pm`, through a client generated from the API contract.

## What it does

- **Sign in with Google** through the Cognito Hosted UI in a Custom Tab (authorization code + PKCE, [AppAuth](https://github.com/openid/AppAuth-Android)). The Hosted UI domain, the Android client ID and its redirect URI come from `GET /v1/meta`, so only the API URL is built in.
- **Garage**: your vehicles and the ones shared with you.
- **Fill-ups**: newest first, 20 per page (`limit`/`cursor`/`order=desc`).
- **Add a fill-up, online or not.** It is saved to a Room queue first. A WorkManager job sends it when there's a network, using the queue entry's ID as the `Idempotency-Key`, so retries and restarts never record it twice. A fill-up the API rejects stays in the list, marked, until you discard it.
- **Offline viewing**: the last garage and each vehicle's newest page of fill-ups are kept on the device (`files/snapshots`) and shown offline, labelled "Offline · last updated …". Sign-out deletes them.
- **Version gate**: if `/v1/meta` says `minimumVersions.android` is above this build, the app asks for an update instead of signing in.

## Build

Requires JDK 17 and the Android SDK (platform 36). Android Studio provides both; open `android/`.

```bash
cd android
./gradlew :app:assembleStagingDebug          # app/build/outputs/apk/staging/debug/
./gradlew :app:testStagingDebugUnitTest      # JVM unit tests
./gradlew :app:lintStagingDebug
./gradlew :app:assembleProductionRelease     # unsigned, R8-minified
```

On the command line, put the SDK path in `android/local.properties` (`sdk.dir=…`, git-ignored) or set `ANDROID_HOME`.

| Flavor | Application ID | API | Sign-in redirect |
|---|---|---|---|
| `staging` | `app.pawsitivemileage.staging` | `https://api-staging.pawsitivemileage.app` | `app.pawsitivemileage.staging://callback` |
| `production` | `app.pawsitivemileage` | `https://api.pawsitivemileage.app` | `app.pawsitivemileage://callback` |

The two install side by side. The redirect URIs are registered on each environment's Cognito Android client (`infra/lib/client-metadata.ts`).

## The generated API client

`./gradlew :app:generateApiClient` (run automatically before every build) generates Retrofit interfaces and kotlinx.serialization models from `packages/contracts/openapi.json` into `app/build/generated/openapi`. Nothing generated is committed: change the contract, regenerate `openapi.json` (`npm run openapi -w @pawsitivemileage/contracts`), and the next Android build uses it.

- `prepareApiSpec` drops `additionalProperties` from object schemas in a build-time copy. The API's response schemas are open so clients tolerate new fields; the Kotlin generator can't compile those, and the app ignores unknown keys anyway.
- Numbers map to `Double`, and UUID and URI formats to `String`.
- `ApiClient` adds `X-Client: android/<version>` and the bearer token, decodes leniently, and turns the `{ error, code, requestId }` envelope into `ApiException`. Enum query parameters go out as their contract value (`order=desc`).

## Layout

```
app/src/main/kotlin/app/pawsitivemileage/
├── PawsitiveApp.kt        # Application + AppContainer (wiring, no DI framework)
├── MainActivity.kt        # sign-in gate and navigation
├── api/                   # ApiClient, ApiException, enum query converter
├── auth/                  # AuthManager (AppAuth), AuthConfig from /v1/meta, SecureStore (Keystore AES-GCM)
├── data/                  # Room queue of pending fill-ups, FillupRepository, SnapshotCache (offline copies)
├── sync/                  # SyncWorker (WorkManager), SyncOutcome
└── ui/                    # Compose screens: sign-in, garage, vehicle, add fill-up
```

## Security notes

- Tokens (AppAuth's `AuthState`) are encrypted with an AES key held in the Android Keystore and excluded from backups and device transfer (`res/xml/*_rules.xml`); a restored device signs in again.
- Sign-out revokes the refresh token at Cognito.
- The Android client is public (no secret) and gets `openid email profile` only; PKCE protects the code exchange.

## Not yet

Maintenance, photos and receipts, analytics, editing, a real launcher icon, release signing and Play Console setup. Release builds are unsigned; signing and the Play upload come with the first Play release.
