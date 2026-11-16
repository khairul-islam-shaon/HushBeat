/**
 * HushBeat - Google Health Connect Sync Service
 *
 * Uses react-native-health-connect v4+ to read watch metrics synced from
 * Zeblaze Btalk 4 Pro (via Zeblaze Connect -> Health Connect).
 *
 * 100% offline, local-first. Zero external cloud / analytics.
 */

import {
  getGrantedPermissions,
  initialize,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import { Permission } from 'react-native-health-connect/lib/typescript/types';
import {
  WatchDailyMetrics,
  getWatchDailyMetricsByDate,
  upsertWatchDailyMetrics,
} from '../db/database';
import { useHealthStore } from '../store/useHealthStore';

export interface DaytimeStressAlert {
  date: string; // YYYY-MM-DD
  startTime: string; // ISO 8601
  endTime: string;
  avgHr: number;
  steps: number;
  elevationAboveResting: number;
  restingHr: number;
}

export interface SyncResult {
  success: boolean;
  daysSynced: number;
  stressAlerts: DaytimeStressAlert[];
  errors: string[];
}

const HEALTH_CONNECT_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'Steps' },
];

/**
 * Initializes Health Connect client and checks/requests read permissions.
 */
export async function initializeAndAuthorizeHealthConnect(): Promise<boolean> {
  try {
    const isInit = await initialize();
    if (!isInit) {
      console.warn('Health Connect initialization returned false.');
      return false;
    }

    const granted = await getGrantedPermissions();
    const hasAll = HEALTH_CONNECT_PERMISSIONS.every((perm) =>
      granted.some(
        (g) => 'recordType' in g && g.recordType === perm.recordType && g.accessType === 'read'
      )
    );

    if (hasAll) {
      return true;
    }

    const requestResult = await requestPermission(HEALTH_CONNECT_PERMISSIONS);
    return requestResult.length > 0;
  } catch (error) {
    console.warn('Health Connect authorization failed:', error);
    return false;
  }
}

/**
 * Helper to extract YYYY-MM-DD from an ISO string in local timezone.
 */
function getLocalDateString(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Syncs the last 14 days of watch biometrics from Google Health Connect into local SQLite.
 */
export async function syncHealthConnectWatchMetrics(
  lookbackDays: number = 14
): Promise<SyncResult> {
  const errors: string[] = [];
  const stressAlerts: DaytimeStressAlert[] = [];

  const isAuth = await initializeAndAuthorizeHealthConnect();
  if (!isAuth) {
    return {
      success: false,
      daysSynced: 0,
      stressAlerts: [],
      errors: ['Health Connect permissions not granted or SDK unavailable.'],
    };
  }

  const now = new Date();
  const startTime = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const endTime = now.toISOString();

  const timeRangeFilter = {
    operator: 'between' as const,
    startTime,
    endTime,
  };

  // 1. Fetch records across the 4 key categories
  let heartRateRecords: any[] = [];
  let restingHrRecords: any[] = [];
  let sleepRecords: any[] = [];
  let stepRecords: any[] = [];

  try {
    const hrRes = await readRecords('HeartRate', { timeRangeFilter });
    heartRateRecords = hrRes.records;
  } catch (err: any) {
    errors.push(`HeartRate read error: ${err?.message || err}`);
  }

  try {
    const rhrRes = await readRecords('RestingHeartRate', { timeRangeFilter });
    restingHrRecords = rhrRes.records;
  } catch (err: any) {
    errors.push(`RestingHeartRate read error: ${err?.message || err}`);
  }

  try {
    const sleepRes = await readRecords('SleepSession', { timeRangeFilter });
    sleepRecords = sleepRes.records;
  } catch (err: any) {
    errors.push(`SleepSession read error: ${err?.message || err}`);
  }

  try {
    const stepRes = await readRecords('Steps', { timeRangeFilter });
    stepRecords = stepRes.records;
  } catch (err: any) {
    errors.push(`Steps read error: ${err?.message || err}`);
  }

  // 2. Bucket records by date (YYYY-MM-DD)
  const dailyData: Record<
    string,
    {
      steps: number;
      sleepMinutes: number;
      sleepDeepMinutes: number;
      sleepRemMinutes: number;
      sleepLightMinutes: number;
      hrSamples: Array<{ bpm: number; time: string }>;
      explicitRestingHr?: number;
    }
  > = {};

  // Initialize all days in range so empty days have a slot
  for (let i = 0; i <= lookbackDays; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = getLocalDateString(d.toISOString());
    dailyData[dateStr] = {
      steps: 0,
      sleepMinutes: 0,
      sleepDeepMinutes: 0,
      sleepRemMinutes: 0,
      sleepLightMinutes: 0,
      hrSamples: [],
    };
  }

  // Group Steps
  for (const record of stepRecords) {
    const dateStr = getLocalDateString(record.startTime);
    if (!dailyData[dateStr]) {
      dailyData[dateStr] = {
        steps: 0,
        sleepMinutes: 0,
        sleepDeepMinutes: 0,
        sleepRemMinutes: 0,
        sleepLightMinutes: 0,
        hrSamples: [],
      };
    }
    dailyData[dateStr].steps += record.count || 0;
  }

  // Group Sleep Sessions
  for (const record of sleepRecords) {
    const dateStr = getLocalDateString(record.startTime);
    if (!dailyData[dateStr]) {
      dailyData[dateStr] = {
        steps: 0,
        sleepMinutes: 0,
        sleepDeepMinutes: 0,
        sleepRemMinutes: 0,
        sleepLightMinutes: 0,
        hrSamples: [],
      };
    }
    const startMs = Date.parse(record.startTime);
    const endMs = Date.parse(record.endTime);
    const durationMin = Math.max(0, Math.round((endMs - startMs) / 60000));
    dailyData[dateStr].sleepMinutes += durationMin;

    if (Array.isArray(record.stages)) {
      for (const stage of record.stages) {
        const stageStart = Date.parse(stage.startTime);
        const stageEnd = Date.parse(stage.endTime);
        const stageMin = Math.round((stageEnd - stageStart) / 60000);
        // Stage numbers: 4/5 = deep, 6 = rem, 1/2 = light
        if (stage.stage === 4 || stage.stage === 5) {
          dailyData[dateStr].sleepDeepMinutes += stageMin;
        } else if (stage.stage === 6) {
          dailyData[dateStr].sleepRemMinutes += stageMin;
        } else {
          dailyData[dateStr].sleepLightMinutes += stageMin;
        }
      }
    }
  }

  // Group Heart Rate Samples
  for (const record of heartRateRecords) {
    if (Array.isArray(record.samples)) {
      for (const sample of record.samples) {
        const dateStr = getLocalDateString(sample.time);
        if (!dailyData[dateStr]) {
          dailyData[dateStr] = {
            steps: 0,
            sleepMinutes: 0,
            sleepDeepMinutes: 0,
            sleepRemMinutes: 0,
            sleepLightMinutes: 0,
            hrSamples: [],
          };
        }
        if (sample.beatsPerMinute > 30 && sample.beatsPerMinute < 240) {
          dailyData[dateStr].hrSamples.push({
            bpm: sample.beatsPerMinute,
            time: sample.time,
          });
        }
      }
    }
  }

  // Group Explicit Resting Heart Rate Records
  for (const record of restingHrRecords) {
    const dateStr = getLocalDateString(record.time);
    if (dailyData[dateStr] && record.beatsPerMinute > 30 && record.beatsPerMinute < 150) {
      dailyData[dateStr].explicitRestingHr = record.beatsPerMinute;
    }
  }

  // 3. Aggregate each day and upsert to SQLite
  let syncedCount = 0;

  for (const [dateStr, data] of Object.entries(dailyData)) {
    const hrValues = data.hrSamples.map((s) => s.bpm);
    let minHr: number | null = null;
    let maxHr: number | null = null;
    let avgHr: number | null = null;
    let restingHr: number | null = null;

    if (hrValues.length > 0) {
      minHr = Math.min(...hrValues);
      maxHr = Math.max(...hrValues);
      const sum = hrValues.reduce((a, b) => a + b, 0);
      avgHr = Math.round((sum / hrValues.length) * 10) / 10;

      // Resting HR resolution
      if (data.explicitRestingHr) {
        restingHr = data.explicitRestingHr;
      } else {
        // Fallback: sort heart rates and take 10th percentile of valid resting/sleep samples
        const sorted = [...hrValues].sort((a, b) => a - b);
        const p10Index = Math.floor(sorted.length * 0.1);
        restingHr = sorted[Math.max(0, p10Index)];
      }
    }

    const metricsToUpsert: Omit<WatchDailyMetrics, 'id'> = {
      date: dateStr,
      restingHr,
      avgHr,
      maxHr,
      minHr,
      totalSteps: data.steps,
      sleepDurationMinutes: data.sleepMinutes,
      sleepDeepMinutes: data.sleepDeepMinutes > 0 ? data.sleepDeepMinutes : null,
      sleepRemMinutes: data.sleepRemMinutes > 0 ? data.sleepRemMinutes : null,
      sleepLightMinutes: data.sleepLightMinutes > 0 ? data.sleepLightMinutes : null,
      spo2Avg: null,
    };

    await upsertWatchDailyMetrics(metricsToUpsert);
    syncedCount++;

    // 4. Passive Daytime Stress Detection in 15-minute windows
    // Window: 08:00 to 22:00. Flag if HR > restingHr + 30 while steps < 15.
    if (restingHr && data.hrSamples.length > 10) {
      const dayStartMs = new Date(`${dateStr}T08:00:00`).getTime();
      const dayEndMs = new Date(`${dateStr}T22:00:00`).getTime();
      const windowMs = 15 * 60 * 1000;

      for (let wStart = dayStartMs; wStart < dayEndMs; wStart += windowMs) {
        const wEnd = wStart + windowMs;

        // Samples in this 15m window
        const windowHrSamples = data.hrSamples.filter((s) => {
          const t = Date.parse(s.time);
          return t >= wStart && t < wEnd;
        });

        if (windowHrSamples.length >= 3) {
          const wAvgHr =
            windowHrSamples.reduce((sum, s) => sum + s.bpm, 0) / windowHrSamples.length;

          // Steps in this 15m window
          const wSteps = stepRecords
            .filter((s) => {
              const t = Date.parse(s.startTime);
              return t >= wStart && t < wEnd;
            })
            .reduce((sum, s) => sum + (s.count || 0), 0);

          const elevation = Math.round((wAvgHr - restingHr) * 10) / 10;

          if (elevation > 30 && wSteps < 15) {
            stressAlerts.push({
              date: dateStr,
              startTime: new Date(wStart).toISOString(),
              endTime: new Date(wEnd).toISOString(),
              avgHr: Math.round(wAvgHr),
              steps: wSteps,
              elevationAboveResting: elevation,
              restingHr,
            });
          }
        }
      }
    }
  }

  // 5. Refresh Zustand store
  const todayStr = getLocalDateString(new Date().toISOString());
  const todayMetrics = await getWatchDailyMetricsByDate(todayStr);

  useHealthStore.setState({
    todayWatchMetrics: todayMetrics,
  });

  await useHealthStore.getState().loadInitialData();

  return {
    success: true,
    daysSynced: syncedCount,
    stressAlerts,
    errors,
  };
}
