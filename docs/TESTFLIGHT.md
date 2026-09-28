# TestFlight (parked until an Apple Developer Program account exists)

Today iPhone testers sideload an unsigned `.ipa` with a free Apple ID ([IPHONE-SIDELOAD.md](IPHONE-SIDELOAD.md)):
7-day expiry, 3 apps per phone. With the paid **Apple Developer Program** (USD 99/year) the same Capacitor project
(`apps/mobile/ios`) can go to TestFlight: 90-day builds, up to 10,000 testers by link, no Developer Mode or cable.
Nothing below is set up yet; no Apple credential exists in this repository or its CI.

## Checklist (owner)

- [ ] Enrol in the Apple Developer Program (individual or organisation; an organisation needs a D-U-N-S number).
- [ ] App Store Connect → **Users and Access → Integrations → App Store Connect API** → create a key with the
      *App Manager* role. Keep the `.p8` file private.
- [ ] Certificates, Identifiers & Profiles → register the App ID **`com.penaltykings.test`** (or the final id).
      Capabilities: none needed today (the custom URL scheme `com.penaltykings.test://auth` needs no capability;
      universal links would need *Associated Domains*).
- [ ] App Store Connect → **My Apps → +** → new app "Penalty Kings (Test)", bundle id above, SKU e.g. `pk-test`.
- [ ] Add GitHub **secrets** (names only here, never values in files):
      `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8` (the `.p8` contents),
      `APPLE_TEAM_ID`.
- [ ] Extend the `ios` job in `.github/workflows/test-app.yml`: replace the unsigned archive with
      `xcodebuild archive … DEVELOPMENT_TEAM=$APPLE_TEAM_ID -allowProvisioningUpdates` using the API key
      (`-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`), then
      `xcodebuild -exportArchive` with an `ExportOptions.plist` (`method` = `app-store-connect`), then upload with
      `xcrun altool --upload-app --apiKey … --apiIssuer …` (or fastlane `pilot`).
      Keep the unsigned `.ipa` as well for sideloaders.
- [ ] Versions already fit TestFlight: `CFBundleShortVersionString` = `0.1.0` (MARKETING_VERSION),
      `CFBundleVersion` = the CI run number (always increasing). Bump MARKETING_VERSION for a new public test cycle.
- [ ] `ITSAppUsesNonExemptEncryption` = `false` is already in `Info.plist` (standard HTTPS only), so uploads do not
      stop at the export-compliance question.
- [ ] TestFlight → **External testing**: a group, the test information text ("TEST BUILD · SIMULATED: no real
      payments…"), a privacy policy URL, and the first **Beta App Review** (usually about a day).
- [ ] Review notes for Apple: payments, wallet and Friends are **simulated**; there is no real purchase flow and
      no in-app purchase. If a real purchase is ever added, App Store rules for digital goods apply first.
- [ ] Before any real wallet provider is switched on in an Apple build, re-check [WALLETS.md](WALLETS.md)
      (OAuth return via `com.penaltykings.test://auth`, no private keys in the app).
