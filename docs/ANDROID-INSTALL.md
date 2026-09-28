# Put Penalty Kings (Test) on an Android phone

This is the **test build**: app name "Penalty Kings (Test)", app id `com.penaltykings.test`. Everything money-related
is **simulated** (TEST BUILD · SIMULATED on every screen): no real payments, keys or transactions. It works offline.

## Install

1. On the phone, open this repository on GitHub → **Releases** → the newest `test-app-…` release → under
   **Assets**, tap the **`.apk`** file (`PenaltyKings-Test-0.1.0-build<N>.apk`, or `…-debug.apk`).
2. When the download finishes, tap it. Android asks to **allow installs from this source** (your browser or
   Files app): tap **Settings** → switch on **Allow from this source** → go back.
3. Tap **Install**. If Play Protect warns about an unknown app, choose **Install anyway** (it is a test build
   that is not on the Play Store).
4. Open **Penalty Kings (Test)** and play. The game turns landscape, the screen stays on while you play, and the
   phone buzzes on a kick and on a goal (turn it off in the game's Settings → Vibration).

The **back button**: closes an open menu first, then goes back to Modes; in the middle of a round it always asks
"Leave the match?" first. At Modes it sends the app to the background.

## Signed vs debug builds

| File name | Signed with | Updating |
|---|---|---|
| `PenaltyKings-Test-0.1.0-build<N>.apk` | the project's **test release key** (from GitHub secrets) | installs straight over the previous signed build; your progress stays |
| `PenaltyKings-Test-0.1.0-build<N>-debug.apk` | a throwaway **debug key** (made fresh by each CI run) | Android refuses to update over a different key ("App not installed" / "conflicts with an existing package"): **uninstall the old test app first**, then install. Uninstalling wipes the in-app progress. |

The project owner turns on signed builds once by running the **Test app keystore (manual)** workflow and adding the
four secrets it explains (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`). Moving from a debug build to the first signed build also needs one uninstall.

## Build it yourself (developers)

Needs Node 22, JDK 21 and the Android SDK (platform 36; Android Studio installs it).

```sh
npm ci && npm ci --prefix apps/mobile     # apps/mobile has its own pinned Capacitor packages
npm run build:test-app                    # the web bundle → dist-test-app/ (the app's webDir)
cd apps/mobile && npx cap sync android    # copies it into the Android project
cd android && ./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk (debug key)
```

Or `npx cap open android` and press Run in Android Studio. Version and signing come from environment variables
(`PK_VERSION_NAME`, `PK_VERSION_CODE`, `PK_KEYSTORE_FILE`, …; see `apps/mobile/android/app/build.gradle`).
