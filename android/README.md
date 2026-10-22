# PawsitiveMileage for Android

Native Android app (Kotlin, Jetpack Compose) for PawsitiveMileage, issue #28. It talks to the same `/v1` API as the web app and `pm`, through a client generated from the API contract.

## What it does

- **Sign in with Google** through the Cognito Hosted UI in a Custom Tab (authorization code + PKCE, [AppAuth](https://github.com/openid/AppAuth-Android)). The Hosted UI domain, the Android client ID and its redirect URI come from `GET /v1/meta`, so only the API URL is built in.
- **Garage**: your vehicles (archived ones behind "Show archived") and vehicles shared with you, with who shared them. Add a vehicle; owners edit details, set a photo, and archive or unarchive.
- **Shared vehicles** follow the share's permission: read-only shares are view-only; fuel, maintenance and full shares can add and edit fill-ups and maintenance. Vehicle details stay with the owner.
- **Fill-ups and maintenance** in two tabs, newest first, 20 per page (`limit`/`cursor`/`order=desc`), with maintenance reminders on top. Tap a record to edit or delete it.
- **Add records online or not.** New fill-ups, maintenance and receipts go to a Room queue first. A WorkManager job sends them when there's a network, using the entry's ID as the `Idempotency-Key`, so retries and restarts never record anything twice. An entry the API rejects stays in the list, marked, until you discard it.
- **Receipts** from the camera or a file (photo or PDF): images are re-encoded as JPEG (at most 2560 px), PDFs kept as-is, 10 MB limit. They're uploaded through a presigned URL before the record is created, or attached to an existing record afterwards, and work offline like everything else in the queue.
- **Location**: "Use my location" saves GPS coordinates and the street address (the phone's built-in geocoder; no Google Play Services or API key). The station name is pre-filled from your nearest earlier stop within 200 m.
- **Editing** needs a connection and sends `If-Match`: if someone else changed the record first, the app says so ("Changed somewhere else") instead of overwriting their change.
- **Offline viewing**: the last garage, each vehicle's newest page of fill-ups and maintenance, reminders and maintenance types are kept on the device (`files/snapshots`) and shown offline, labelled "Offline · last updated …". Sign-out deletes them.
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

### A signed build to sideload

Release builds are signed when `android/keystore.properties` exists (git-ignored; CI builds stay unsigned):

```properties
storeFile=/home/you/.pawsitivemileage-android/upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Create the key once with `keytool -genkeypair -keystore ~/.pawsitivemileage-android/upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`, keep it out of the repo, and back it up. With Play App Signing it becomes the *upload* key: Google holds the app signing key, and a lost upload key can be reset through Play support. Then:

```bash
./gradlew :app:assembleProductionRelease   # app/build/outputs/apk/production/release/app-production-release.apk
```

**Easiest:** download it from the phone icon next to the version in the footer of https://pawsitivemileage.app. Every production deploy publishes the current release there (see docs/ci-cd.md); CI signs it with the same key from the `production` environment's secrets.

To sideload a local build instead, copy the APK to the phone, allow your file manager or browser to install unknown apps, and open it. The production build uses the production API and your real data. Installing a newer build over it needs the same key; switching between a debug build and this one means uninstalling first.

R8 shrinks release builds. `app/proguard-rules.pro` keeps the generated Retrofit interfaces and models and the enum fields that Retrofit and the converters use by reflection. Without them, release builds fail at runtime even though debug builds work, so test release builds on a device before shipping.

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
├── api/                   # ApiClient, ApiException, enum query and update-body converters
├── auth/                  # AuthManager (AppAuth), AuthConfig from /v1/meta, SecureStore (Keystore AES-GCM)
├── data/                  # Room queue (Queue, OpQueue), Uploader, Records, Vehicles, SnapshotCache
├── location/              # Locations: GPS + geocoder, nearby station names
├── media/                 # Attachments: camera and file receipts, re-encoding
├── sync/                  # SyncWorker (WorkManager), SyncOutcome
└── ui/                    # Compose screens and form models (Forms.kt)
```

## Security notes

- Tokens (AppAuth's `AuthState`) are encrypted with an AES key held in the Android Keystore and excluded from backups and device transfer (`res/xml/*_rules.xml`); a restored device signs in again.
- Sign-out revokes the refresh token at Cognito.
- The Android client is public (no secret) and gets `openid email profile` only; PKCE protects the code exchange.

## Not yet

Analytics, sharing management, exports and imports, admin, a real launcher icon, and the Play Store listing.
