# HushBeat — Agent Rules (Gemini CLI)

> **STOP. Read `PROGRESS.md` in the project root before starting ANY task.**
> It is the shared memory between Claude Code and Gemini CLI. It tells you what is done,
> what is broken, and the exact next step. Do not redo finished work.
>
> `CLAUDE.md` holds the same rules for Claude Code. If you change a rule here, make the
> same change there so the two files never drift apart.

## Project

- **App name:** HushBeat
- **Android package / app id:** `com.shaon.hushbeat`
- **Purpose:** personal, offline-first health app.
  - Watch sync: Zeblaze Btalk 4 Pro data read through **Google Health Connect**.
  - **Rear-camera PPG** (fingertip over lens + torch) for HRV: **SDNN** and **RMSSD**.
  - **Heart Rate Recovery** at **1 min** and **2 min** after exercise.
  - **Biofeedback breathing** sessions.

## Permanent engineering rules

1. **Package manager: `pnpm` only.** Never run `npm install`, `yarn`, or `bun`. Use
   `pnpm add`, `pnpm exec`, and `pnpm dlx` (or `npx expo install` only through
   `pnpm exec expo install` so the version is right for the Expo SDK).
2. **Runtime: Expo custom dev client** (`expo-dev-client`), **never Expo Go**. Native
   modules (Vision Camera, Health Connect) require a native build
   (`pnpm exec expo prebuild` + `pnpm exec expo run:android`, or an EAS dev build).
3. **Android SDK levels:** `minSdkVersion: 26`, `compileSdkVersion: 36`,
   `targetSdkVersion: 36`. Set via `expo-build-properties` in `app.json`/`app.config.*`,
   not by hand-editing generated `android/` files that prebuild would overwrite.
4. **Storage: 100% local-first `expo-sqlite`.** Zero cloud, zero auth, zero analytics,
   zero network calls with health data. Nothing leaves the device.
5. **Camera PPG pipeline** (`react-native-vision-camera`, frame processors):
   - Capture at **30–60 fps**; use real frame timestamps, not an assumed frame rate.
   - **Bandpass filter 0.5–4.0 Hz** (30–240 bpm) on the red/green channel mean signal.
   - **Parabolic peak interpolation** to get sub-frame peak timing.
   - **Signal Quality Index (SQI) gate** — reject/flag windows with poor signal
     (finger lifted, motion, saturation) before computing metrics.
   - **R-R outlier rejection: drop intervals that differ by >20%** from the previous
     accepted interval (or local median) before computing **SDNN** and **RMSSD**.
6. **Watch sync: `react-native-health-connect` v4+.** **Never** install the deprecated
   `expo-health-connect`. Use its Expo config plugin for permissions.
7. **Verify before claiming done:** run type-checks / tests, and confirm native Android
   builds when native config changes. Report failures honestly in `PROGRESS.md`.

## Mandatory progress protocol

After **every** task or phase, update `PROGRESS.md` with:

- Completed phases, and files created/modified
- Installed packages and native config status
- Known bugs / unfinished work
- The **exact next step**

Also add a dated line to the change log at the bottom of `PROGRESS.md` saying which agent
(Claude Code or Gemini CLI) did the work.
