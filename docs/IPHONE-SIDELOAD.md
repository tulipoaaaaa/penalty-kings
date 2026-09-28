# Put Penalty Kings (Test) on your iPhone (free Apple account)

This is the **test build** of Penalty Kings: app name "Penalty Kings (Test)", app id `com.penaltykings.test`.
Everything money-related in it is **simulated** (every screen says TEST BUILD · SIMULATED): no real payments, no real
wallet keys, no real transactions. It works without internet once installed.

The project has no paid Apple Developer account yet, so the iPhone file is **unsigned**: Apple does not let an
iPhone run an app until someone signs it. You sign it yourself, for your own phone, with a **free Apple ID**. It
takes about 15 minutes the first time.

**Your Apple ID stays with you.** You type it only into Xcode or Sideloadly on your own computer. Never put it (or a
password, or an app-specific password) in the repository, a GitHub secret, an issue or a chat.

## What you need

- An iPhone (iOS 16 or newer is assumed below) and its USB cable.
- A free Apple ID (the one you use for the App Store is fine; a separate one just for testing is also fine).
- **Either** a Mac with Xcode (path A) **or** a Windows PC with Sideloadly (path B).
- The file **`PenaltyKings-Test-unsigned.ipa`**: open this repository on GitHub → **Releases** → the newest
  `test-app-…` release → download it under **Assets**.

## Path A: a Mac with Xcode

1. Install **Xcode** from the Mac App Store and open it once (let it install its extra components).
2. Xcode → **Settings → Accounts** → **+** → **Apple ID** → sign in. A "Personal Team" appears under your name.
3. Get the project. If you are comfortable with Terminal, from a copy of this repository:
   ```sh
   npm ci && npm ci --prefix apps/mobile
   npm run build:test-app
   cd apps/mobile && npx cap sync ios && open ios/App/App.xcodeproj
   ```
   (If you only have the `.ipa` and no source code, the easiest route on a Mac is Sideloadly for Mac: follow path B,
   the steps are the same.)
4. In Xcode, click **App** (the blue icon at the top of the left panel) → target **App** → **Signing & Capabilities**:
   - tick **Automatically manage signing**;
   - **Team**: choose *Your Name (Personal Team)*;
   - **Bundle Identifier**: `com.penaltykings.test`. If Xcode says the id "is not available" or "cannot be
     registered", someone else's free team already used it: add your initials, e.g. `com.penaltykings.test.ab`.
5. Plug in the iPhone, unlock it, tap **Trust This Computer** if asked.
6. At the top of Xcode, pick your iPhone as the run destination, then press **Run** (▶).
7. The first time, the iPhone refuses to open the app until you do the two phone steps below
   (**Developer Mode** and **Trust**). Then press Run again.

## Path B: Windows with Sideloadly

1. Install **iTunes** and **iCloud** from **Apple's website** (apple.com), **not** the Microsoft Store versions:
   Sideloadly talks to the iPhone through them. Sideloadly's own site (sideloadly.io) lists the exact current
   requirements; check it first, they change from time to time.
2. Install **Sideloadly** from sideloadly.io (only from that site).
3. Plug in the iPhone, unlock it, tap **Trust This Computer**. Your iPhone appears in Sideloadly's device list.
4. Drag **`PenaltyKings-Test-unsigned.ipa`** onto the Sideloadly window.
5. Type your Apple ID in the Apple account box and press **Start**. Sideloadly asks for your password (and a
   two-factor code if your Apple ID uses it). It sends them only to Apple, to make a free signing certificate.
   - If Sideloadly says the bundle id is already in use, open **Advanced options** and change the bundle id to
     something unique such as `com.penaltykings.test.ab` (your initials).
6. Wait for "Done". The app icon (a gold ball in front of a goal) is on the home screen. Do the phone steps below.

## Phone steps (once per phone)

### Turn on Developer Mode

iPhone **Settings → Privacy & Security → Developer Mode** → switch it **on** → **Restart**. After the restart,
unlock the phone and confirm **Turn On**. (The Developer Mode switch only appears after an app from Xcode or
Sideloadly has been installed on the phone once.)

### Trust your Apple ID as a developer

iPhone **Settings → General → VPN & Device Management** → under *Developer App*, tap **your Apple ID** → **Trust
"your Apple ID"** → **Trust**.

Now open **Penalty Kings (Test)**. Turn the phone sideways to play.

## Limits of a free Apple account

- **The app stops opening after 7 days.** That is Apple's rule for free accounts. To keep playing, **install it
  again the same way** (same Apple ID, same bundle id): press Run in Xcode again, or drag the `.ipa` into
  Sideloadly and press Start again. Reinstalling over the old app **keeps your in-app progress** (your test account,
  simulated RF, Friend, stars): it lives on the phone. Only deleting the app wipes it.
- **At most 3 sideloaded apps** can be installed at once with a free account (and only 10 new app ids per week).
  Remove an old sideloaded app if you hit the limit.
- A new test release can be installed the same way over the old one (same bundle id); your progress stays.

## If something goes wrong

| You see | Do this |
|---|---|
| "Untrusted Developer" | Do **Trust your Apple ID** above. |
| "Developer Mode required" / the app does not open | Do **Turn on Developer Mode** above (with the restart). |
| The app opened for a week, now it will not | The 7-day limit: reinstall (your progress is kept). |
| "Maximum number of apps" | Delete another sideloaded app (free accounts: 3). |
| "Bundle identifier is not available" | Change the suffix: `com.penaltykings.test.<your initials>`. |
| Sideloadly does not see the iPhone | Use iTunes/iCloud from apple.com (not Microsoft Store), unlock the phone, re-plug, tap Trust. |

Later, when the project has a paid Apple Developer Program account, testers get the app through TestFlight
instead, with no 7-day limit ([TESTFLIGHT.md](TESTFLIGHT.md)).
