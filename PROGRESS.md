# HushBeat — PROGRESS (shared agent memory)

> Read this first, every session. Update it after every task or phase.
> Rules live in `CLAUDE.md` (Claude Code) and `GEMINI.md` (Gemini CLI).

**Last updated:** 2026-11-17 by Gemini CLI
**Current phase:** Phase 4 complete — Health Connect sync service v4+ (14-day history, fallback resting HR, passive daytime stress detection), HR Recovery screen, and test suite verified (28/28 tests passing). Ready for Phase 5.

## Completed phases & files

### Phase 0 — Shared agent memory & hardware reference
- Created `CLAUDE.md` — permanent engineering rules for Claude Code.
- Created `GEMINI.md` — the same rules for Gemini CLI.
- Created `PROGRESS.md` — this file.
- Already in repo: `README.md` (one line, from the first commit).
- Imported `Zeblaze_Btalk4Pro_Spec/` — verified BLE protocol spec v2.2.0, official APK/DEX, HCI snoop captures, analysis tools, and screenshots.

### Phase 1 — Expo TypeScript scaffold, native packages & Android prebuild
- Scaffolded Expo SDK 58 blank TypeScript app (`App.tsx`, `index.ts`, `tsconfig.json`, `assets/`, `.gitignore`) preserving all existing repo files (`.git`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`, `README.md`, `Zeblaze_Btalk4Pro_Spec/`).
- Installed all core packages via `pnpm add` / `pnpm exec expo install`:
  - `react-native-vision-camera` (5.2.4)
  - `react-native-nitro-modules` (0.37.2) & `react-native-nitro-image` (0.15.2)
  - `react-native-worklets-core` (1.6.3)
  - `react-native-health-connect` (4.1.3)
  - `expo-sqlite` (58.0.17)
  - `zustand` (5.1.0)
  - `expo-dev-client` (58.0.20)
  - `expo-build-properties` (58.0.12)
  - `expo-system-ui` (58.0.7)
- Configured `app.json`:
  - Package: `com.shaon.hushbeat`
  - SDK Levels via `expo-build-properties`: `minSdkVersion: 26`, `compileSdkVersion: 36`, `targetSdkVersion: 36`
  - Health Connect config plugin (`react-native-health-connect`) generating rationale intent filters and `ViewPermissionUsageActivity` alias
  - Explicit Android permissions: `CAMERA`, `READ_HEART_RATE`, `READ_RESTING_HEART_RATE`, `READ_SLEEP`, `READ_STEPS`
  - iOS `NSCameraUsageDescription` configured
  - Handled VisionCamera v5 configuration: v5 is built on Nitro modules without a legacy Expo config plugin; native permissions are provided directly in manifest permissions, avoiding Node-time native C++ module load failures during prebuild
- Generated native `android/` project via `pnpm exec expo prebuild --clean`.
- Verified build configuration:
  - TypeScript compilation check (`pnpm tsc --noEmit`): clean, 0 errors.
  - Gradle task evaluation (`./gradlew.bat help`): clean, successfully autolinked all Nitro, VisionCamera, HealthConnect, SQLite, and DevClient modules with `minSdk: 26`, `compileSdk: 36`, `targetSdk: 36`.

### Phase 2 — Local SQLite persistence layer & pure TypeScript biometric math modules
- Built `src/db/database.ts` using `expo-sqlite` modern async API (`openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`):
  - Tables: `hrv_scans`, `watch_daily_metrics`, `hrr_sessions`, and `habit_logs`.
  - Pragmas: `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`.
  - Indexes on timestamps, dates, and habit types.
  - Clean typed CRUD helper functions:
    - HRV scans: `insertHrvScan`, `getHrvScans`, `getLatestHrvScan`, `deleteHrvScan`.
    - Watch daily metrics: `upsertWatchDailyMetrics`, `getWatchDailyMetricsByDate`, `getWatchDailyMetricsRange`.
    - HR recovery: `insertHrrSession`, `getHrrSessions`, `getLatestHrrSession`.
    - Habits: `insertHabitLog`, `getHabitLogsByDate`, `getHabitLogsByType`.
    - 14-day rolling baseline query helper: `get14DayBaseline()`.
- Built `src/utils/ppgFilter.ts`:
  - 0.5–4.0 Hz digital bandpass filter (30–240 bpm) to strip tremor and baseline drift.
  - Cascaded 2nd-order Butterworth highpass (0.5 Hz) and lowpass (4.0 Hz) biquad sections.
  - Zero-phase filtering (`applyBandpassFilter`) with DC mean removal and streaming processor (`PPGBandpassFilter`).
  - Signal Quality Index (`checkSignalQuality`) detecting clipping, finger liftoff, flatlines, and sudden motion spikes.
- Built `src/utils/hrvMath.ts`:
  - 3-point parabolic peak interpolation (`parabolicPeakInterpolation`) for sub-frame / millisecond peak timing.
  - Peak detection with refractory gating (`detectPpgPeaks`).
  - R-R interval extraction with >20% outlier rejection from rolling median (`extractAndFilterRrIntervals`).
  - Biometric metrics extraction: `avgBpm`, `sdnnMs`, `rmssdMs`, `stressScore` (0–100), and `readinessScore` (0–100 against 14-day rolling baseline or clinical norms).
  - End-to-end window processor (`processPpgForHrv`).
- Testing & Quality Verification:
  - Configured Jest with `jest-expo`, `babel.config.js`, and `tsconfig.json` types.
  - Created unit tests in `src/utils/__tests__/hrvMath.test.ts` covering clean pulse waves, noisy spikes (>20% rejection), low SQI clipping/motion, stress/readiness scoring, and the end-to-end pipeline.
  - Test results: **22/22 passed**.
  - TypeScript check: `pnpm exec tsc --noEmit` passed with **0 errors**.

### Phase 3 — Zustand store, Camera PPG ScannerScreen & Resonance BreathingScreen
- Installed `expo-haptics` (~58.0.8) via `pnpm exec expo install expo-haptics` for tactile biofeedback transitions.
- Built `src/store/useHealthStore.ts` (Zustand):
  - Active scanning state management: `isScanning`, `isPaused`, `scanType`, `elapsedSeconds`, `targetDurationSeconds`, `liveBpm`, `liveSqi`, `isFingerDetected`, `sqiReasons`, `liveWaveform`.
  - HRV & metric state: `latestScan`, `preBreathingScan`, `postBreathingScan`, `recentScans`, `baseline`, `todayWatchMetrics`.
  - Store actions for starting/stopping/pausing scans, streaming live waveform points, auto-saving completed scans to SQLite, and loading baseline/history.
- Built `src/screens/ScannerScreen.tsx`:
  - Camera setup: Clean permission request (`useCameraPermission`), rear camera selection (`useCameraDevice('back')`), torch activated on scan (`torchMode="on"`), and camera exposure/white balance locked on preview start (`lockCurrentExposure`, `lockCurrentWhiteBalance`).
  - Frame processor (`useFrameOutput` via `react-native-worklets-core`): Extracts mean red-channel brightness from center 50x50 region at native frame rate with timestamps, dispatched synchronously to JS via `useRunOnJS`.
  - Signal processing: Real-time streaming through `PPGBandpassFilter` and sliding window `checkSignalQuality`.
  - UI Features: Live scrolling pulse waveform (responsive 50-bar visualizer), live BPM display, Signal Quality Index badge (Good/Moderate/Poor), scan-type selector (Morning Check, Pre-Breathing, Post-Breathing, Spot Check), and 60-second countdown with auto-pause if SQI < 60% with positioning prompt.
  - Auto-save & Summary: Persists complete 60-second window to SQLite (`hrv_scans`) and renders detailed summary card (BPM, SDNN, RMSSD, Stress Score, Readiness Score).
- Built `src/screens/BreathingScreen.tsx`:
  - 3-minute coherent resonance breathing pacer (5.5s inhale, 5.5s exhale = 5.5 bpm) driven by smooth `Animated.timing` sine-eased scaling circle.
  - Tactile biofeedback: Gentle haptic feedback (`Haptics.impactAsync`) on each inhale/exhale transition.
  - Optional live PPG monitoring: Toggleable rear-camera PPG pulse monitor allowing users to observe their pulse wave stabilizing during breathing.
  - Biofeedback verification: Quick shortcuts for 60s Pre-Breathing and Post-Breathing scans with automatic SDNN delta and percentage improvement calculation.
  - Auto-logs completed 3-minute sessions to SQLite `habit_logs`.
- Integrated dark-themed tab navigation in `App.tsx` with database initialization on launch.
- Verification:
  - TypeScript compilation check (`pnpm exec tsc --noEmit`): clean, **0 errors**.
  - Unit test suite (`pnpm test`): **22/22 tests passing**.

### Phase 4 — Google Health Connect watch sync & Heart Rate Recovery (HRR) timer
- Built `src/services/healthConnectSync.ts` using `react-native-health-connect` v4+:
  - Requests read permissions for `HeartRate`, `RestingHeartRate`, `SleepSession`, and `Steps`.
  - Fetches last 14 days of records synced from Zeblaze Connect via Health Connect.
  - Aggregates daily steps, sleep minutes (deep, rem, light), and heart rate ranges.
  - Fallback resting HR algorithm: If explicit `RestingHeartRate` records are absent, calculates lowest stable resting HR from 10th percentile of idle/sleep samples.
  - Passive daytime stress alert analyzer: Scans 08:00 to 22:00 in 15-minute sliding windows and flags any window where heart rate exceeds daily resting HR by >30 BPM while step count is <15 steps.
  - Refreshes Zustand store (`useHealthStore`) and 14-day baseline after sync.
- Built `src/screens/RecoveryTimerScreen.tsx`:
  - Post-exercise Heart Rate Recovery (HRR) evaluation screen.
  - Peak HR capture via quick 10s rear-camera PPG scan or direct manual entry from Zeblaze Btalk 4 Pro display.
  - 2-minute (120s) countdown timer with vibration alerts (`Vibration.vibrate`) at the 1:00 (60s, double buzz) and 2:00 (120s, long buzz) marks.
  - Records `bpm_1min` and `bpm_2min`, computes 1-minute and 2-minute drops, evaluates Vagal Rebound rating (Strong $\ge 18$ BPM, Healthy $12–17$ BPM, Fatigued $<12$ BPM), and persists sessions to `hrr_sessions` in SQLite.
- Updated `App.tsx` with top-bar "⌚ Sync Watch" trigger and added Recovery tab.
- Added test suite in `src/services/__tests__/healthConnectSync.test.ts` (passive stress detection, resting HR fallback, HRR classification).
- Verification:
  - TypeScript check (`pnpm exec tsc --noEmit`): clean, **0 errors**.
  - Jest unit tests (`pnpm test`): **28/28 tests passing across 2 test suites**.

## Installed packages & native config status

- **Expo & React Native:** Expo SDK 58, React 19.3.0, React Native 0.88.1.
- **Native modules installed & autolinked:** `react-native-vision-camera`, `react-native-nitro-modules`, `react-native-nitro-image`, `react-native-worklets-core`, `react-native-health-connect`, `expo-sqlite`, `expo-dev-client`, `expo-build-properties`, `expo-system-ui`, `expo-haptics`.
- **Dev Dependencies:** `jest` (^30.5.2), `jest-expo` (^58.0.14), `@types/jest` (^30.0.0), `babel-preset-expo` (^58.0.25).
- **Native Android config:**
  - `android/` generated and verified.
  - `minSdkVersion: 26`, `compileSdkVersion: 36`, `targetSdkVersion: 36` in `gradle.properties`.
  - AndroidManifest has `CAMERA` and all 4 Health Connect read permissions + Health Connect privacy rationale intent filters.

## Known bugs / unfinished work

- None. All 28 unit tests passing; TypeScript verification completely clean.

## Exact next step

Proceed with **Phase 5**: Health Dashboard screen (visualizing 14-day trends, readiness score, daily resting HR from watch, HRV SDNN/RMSSD timeline, and daytime stress alerts) or release packaging / APK verification.

---

## Change log

- 2026-11-15 — Claude Code — Phase 0: created `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- 2026-11-16 — Gemini CLI — Phase 0: imported `Zeblaze_Btalk4Pro_Spec/` reference folder into project root.
- 2026-11-16 — Gemini CLI — Phase 1: scaffolded Expo TS app, installed native packages, configured `app.json`, generated `android/` via prebuild, verified TypeScript and Gradle builds.
- 2026-11-16 — Gemini CLI — Phase 2: built SQLite persistence layer, pure TS biometric math modules (ppgFilter + hrvMath), configured Jest, wrote 22 unit tests (all passing), verified clean TypeScript compilation.
- 2026-11-17 — Gemini CLI — Phase 3: created Zustand health store, Camera PPG ScannerScreen (worklet frame processor, live waveform, SQI auto-pause, SQLite auto-save), and Resonance BreathingScreen with haptics and pre/post SDNN delta.
- 2026-11-17 — Gemini CLI — Phase 4: created Health Connect watch sync service v4+ (14-day history, fallback resting HR, passive daytime stress alerts), HR Recovery timer screen (vibration alerts & vagal rebound rating), and expanded test suite to 28 passing tests.
