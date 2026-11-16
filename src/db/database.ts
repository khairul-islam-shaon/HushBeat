/**
 * HushBeat - Local-first SQLite Persistence Layer
 *
 * Rules: 100% offline, local-first storage using expo-sqlite modern async API.
 * Zero network, zero cloud, zero telemetry.
 */

import * as SQLite from 'expo-sqlite';

export const DATABASE_NAME = 'hushbeat.db';

export interface HrvScan {
  id?: number;
  timestamp: string; // ISO 8601 string
  avgBpm: number;
  sdnnMs: number;
  rmssdMs: number;
  stressScore: number;
  readinessScore: number;
  sqiScore: number;
  rrIntervals: number[]; // R-R intervals in milliseconds
  notes?: string | null;
  createdAt?: string;
}

export interface WatchDailyMetrics {
  id?: number;
  date: string; // 'YYYY-MM-DD'
  restingHr?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  minHr?: number | null;
  totalSteps?: number | null;
  sleepDurationMinutes?: number | null;
  sleepDeepMinutes?: number | null;
  sleepRemMinutes?: number | null;
  sleepLightMinutes?: number | null;
  spo2Avg?: number | null;
  syncedAt?: string;
}

export interface HrrSession {
  id?: number;
  timestamp: string; // ISO 8601 string
  exerciseType: string;
  peakHr: number;
  hrAt1min: number;
  hrAt2min: number;
  hrr1min: number; // peakHr - hrAt1min
  hrr2min: number; // peakHr - hrAt2min
  recoveryScore?: number | null;
  createdAt?: string;
}

export interface HabitLog {
  id?: number;
  date: string; // 'YYYY-MM-DD'
  habitType: string; // e.g. 'breathing_biofeedback', 'hydration', 'stretch'
  durationSeconds: number;
  value?: number | null;
  notes?: string | null;
  completedAt?: string;
}

export interface Rolling14DayBaseline {
  avgSdnnMs: number | null;
  avgRmssdMs: number | null;
  avgRestingHr: number | null;
  avgSleepMinutes: number | null;
  scanCount: number;
  metricsCount: number;
}

// Database singleton instance
let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync(DATABASE_NAME);
  }
  return dbInstance;
}

/**
 * Initializes tables, indexes, and SQLite pragmas.
 */
export async function initDatabase(db?: SQLite.SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS hrv_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      avg_bpm REAL NOT NULL,
      sdnn_ms REAL NOT NULL,
      rmssd_ms REAL NOT NULL,
      stress_score INTEGER NOT NULL,
      readiness_score INTEGER NOT NULL,
      sqi_score REAL NOT NULL,
      rr_intervals TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hrv_scans_timestamp ON hrv_scans(timestamp);

    CREATE TABLE IF NOT EXISTS watch_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      resting_hr REAL,
      avg_hr REAL,
      max_hr REAL,
      min_hr REAL,
      total_steps INTEGER,
      sleep_duration_minutes INTEGER,
      sleep_deep_minutes INTEGER,
      sleep_rem_minutes INTEGER,
      sleep_light_minutes INTEGER,
      spo2_avg REAL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_watch_daily_metrics_date ON watch_daily_metrics(date);

    CREATE TABLE IF NOT EXISTS hrr_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      exercise_type TEXT NOT NULL,
      peak_hr REAL NOT NULL,
      hr_at_1min REAL NOT NULL,
      hr_at_2min REAL NOT NULL,
      hrr_1min REAL NOT NULL,
      hrr_2min REAL NOT NULL,
      recovery_score REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hrr_sessions_timestamp ON hrr_sessions(timestamp);

    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      habit_type TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      value REAL,
      notes TEXT,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
    CREATE INDEX IF NOT EXISTS idx_habit_logs_type ON habit_logs(habit_type);
  `);
}

// -------------------------------------------------------------
// HRV Scans CRUD
// -------------------------------------------------------------

interface RawHrvScanRow {
  id: number;
  timestamp: string;
  avg_bpm: number;
  sdnn_ms: number;
  rmssd_ms: number;
  stress_score: number;
  readiness_score: number;
  sqi_score: number;
  rr_intervals: string;
  notes: string | null;
  created_at: string;
}

function mapRawHrvScan(row: RawHrvScanRow): HrvScan {
  let rrParsed: number[] = [];
  try {
    rrParsed = JSON.parse(row.rr_intervals);
  } catch {
    rrParsed = [];
  }
  return {
    id: row.id,
    timestamp: row.timestamp,
    avgBpm: row.avg_bpm,
    sdnnMs: row.sdnn_ms,
    rmssdMs: row.rmssd_ms,
    stressScore: row.stress_score,
    readinessScore: row.readiness_score,
    sqiScore: row.sqi_score,
    rrIntervals: rrParsed,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function insertHrvScan(
  scan: Omit<HrvScan, 'id' | 'createdAt'>,
  db?: SQLite.SQLiteDatabase
): Promise<number> {
  const database = db ?? (await getDatabase());
  const serializedRr = JSON.stringify(scan.rrIntervals || []);

  const result = await database.runAsync(
    `INSERT INTO hrv_scans (
      timestamp, avg_bpm, sdnn_ms, rmssd_ms, stress_score, readiness_score, sqi_score, rr_intervals, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scan.timestamp,
      scan.avgBpm,
      scan.sdnnMs,
      scan.rmssdMs,
      scan.stressScore,
      scan.readinessScore,
      scan.sqiScore,
      serializedRr,
      scan.notes ?? null,
    ]
  );

  return result.lastInsertRowId;
}

export async function getHrvScans(
  limit: number = 50,
  offset: number = 0,
  db?: SQLite.SQLiteDatabase
): Promise<HrvScan[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<RawHrvScanRow>(
    `SELECT * FROM hrv_scans ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows.map(mapRawHrvScan);
}

export async function getLatestHrvScan(
  db?: SQLite.SQLiteDatabase
): Promise<HrvScan | null> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<RawHrvScanRow>(
    `SELECT * FROM hrv_scans ORDER BY timestamp DESC LIMIT 1`
  );
  return row ? mapRawHrvScan(row) : null;
}

export async function deleteHrvScan(
  id: number,
  db?: SQLite.SQLiteDatabase
): Promise<boolean> {
  const database = db ?? (await getDatabase());
  const result = await database.runAsync(
    `DELETE FROM hrv_scans WHERE id = ?`,
    [id]
  );
  return result.changes > 0;
}

// -------------------------------------------------------------
// Watch Daily Metrics CRUD
// -------------------------------------------------------------

interface RawWatchDailyMetricsRow {
  id: number;
  date: string;
  resting_hr: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  min_hr: number | null;
  total_steps: number | null;
  sleep_duration_minutes: number | null;
  sleep_deep_minutes: number | null;
  sleep_rem_minutes: number | null;
  sleep_light_minutes: number | null;
  spo2_avg: number | null;
  synced_at: string;
}

function mapRawWatchDailyMetrics(row: RawWatchDailyMetricsRow): WatchDailyMetrics {
  return {
    id: row.id,
    date: row.date,
    restingHr: row.resting_hr,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    minHr: row.min_hr,
    totalSteps: row.total_steps,
    sleepDurationMinutes: row.sleep_duration_minutes,
    sleepDeepMinutes: row.sleep_deep_minutes,
    sleepRemMinutes: row.sleep_rem_minutes,
    sleepLightMinutes: row.sleep_light_minutes,
    spo2Avg: row.spo2_avg,
    syncedAt: row.synced_at,
  };
}

export async function upsertWatchDailyMetrics(
  metrics: Omit<WatchDailyMetrics, 'id'>,
  db?: SQLite.SQLiteDatabase
): Promise<number> {
  const database = db ?? (await getDatabase());
  const result = await database.runAsync(
    `INSERT INTO watch_daily_metrics (
      date, resting_hr, avg_hr, max_hr, min_hr, total_steps,
      sleep_duration_minutes, sleep_deep_minutes, sleep_rem_minutes, sleep_light_minutes,
      spo2_avg, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET
      resting_hr = excluded.resting_hr,
      avg_hr = excluded.avg_hr,
      max_hr = excluded.max_hr,
      min_hr = excluded.min_hr,
      total_steps = excluded.total_steps,
      sleep_duration_minutes = excluded.sleep_duration_minutes,
      sleep_deep_minutes = excluded.sleep_deep_minutes,
      sleep_rem_minutes = excluded.sleep_rem_minutes,
      sleep_light_minutes = excluded.sleep_light_minutes,
      spo2_avg = excluded.spo2_avg,
      synced_at = datetime('now')`,
    [
      metrics.date,
      metrics.restingHr ?? null,
      metrics.avgHr ?? null,
      metrics.maxHr ?? null,
      metrics.minHr ?? null,
      metrics.totalSteps ?? null,
      metrics.sleepDurationMinutes ?? null,
      metrics.sleepDeepMinutes ?? null,
      metrics.sleepRemMinutes ?? null,
      metrics.sleepLightMinutes ?? null,
      metrics.spo2Avg ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export async function getWatchDailyMetricsByDate(
  date: string,
  db?: SQLite.SQLiteDatabase
): Promise<WatchDailyMetrics | null> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<RawWatchDailyMetricsRow>(
    `SELECT * FROM watch_daily_metrics WHERE date = ?`,
    [date]
  );
  return row ? mapRawWatchDailyMetrics(row) : null;
}

export async function getWatchDailyMetricsRange(
  startDate: string,
  endDate: string,
  db?: SQLite.SQLiteDatabase
): Promise<WatchDailyMetrics[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<RawWatchDailyMetricsRow>(
    `SELECT * FROM watch_daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC`,
    [startDate, endDate]
  );
  return rows.map(mapRawWatchDailyMetrics);
}

// -------------------------------------------------------------
// Heart Rate Recovery (HRR) Sessions CRUD
// -------------------------------------------------------------

interface RawHrrSessionRow {
  id: number;
  timestamp: string;
  exercise_type: string;
  peak_hr: number;
  hr_at_1min: number;
  hr_at_2min: number;
  hrr_1min: number;
  hrr_2min: number;
  recovery_score: number | null;
  created_at: string;
}

function mapRawHrrSession(row: RawHrrSessionRow): HrrSession {
  return {
    id: row.id,
    timestamp: row.timestamp,
    exerciseType: row.exercise_type,
    peakHr: row.peak_hr,
    hrAt1min: row.hr_at_1min,
    hrAt2min: row.hr_at_2min,
    hrr1min: row.hrr_1min,
    hrr2min: row.hrr_2min,
    recoveryScore: row.recovery_score,
    createdAt: row.created_at,
  };
}

export async function insertHrrSession(
  session: Omit<HrrSession, 'id' | 'createdAt'>,
  db?: SQLite.SQLiteDatabase
): Promise<number> {
  const database = db ?? (await getDatabase());
  const result = await database.runAsync(
    `INSERT INTO hrr_sessions (
      timestamp, exercise_type, peak_hr, hr_at_1min, hr_at_2min, hrr_1min, hrr_2min, recovery_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.timestamp,
      session.exerciseType,
      session.peakHr,
      session.hrAt1min,
      session.hrAt2min,
      session.hrr1min,
      session.hrr2min,
      session.recoveryScore ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export async function getHrrSessions(
  limit: number = 50,
  db?: SQLite.SQLiteDatabase
): Promise<HrrSession[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<RawHrrSessionRow>(
    `SELECT * FROM hrr_sessions ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
  return rows.map(mapRawHrrSession);
}

export async function getLatestHrrSession(
  db?: SQLite.SQLiteDatabase
): Promise<HrrSession | null> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<RawHrrSessionRow>(
    `SELECT * FROM hrr_sessions ORDER BY timestamp DESC LIMIT 1`
  );
  return row ? mapRawHrrSession(row) : null;
}

// -------------------------------------------------------------
// Habit Logs CRUD
// -------------------------------------------------------------

interface RawHabitLogRow {
  id: number;
  date: string;
  habit_type: string;
  duration_seconds: number;
  value: number | null;
  notes: string | null;
  completed_at: string;
}

function mapRawHabitLog(row: RawHabitLogRow): HabitLog {
  return {
    id: row.id,
    date: row.date,
    habitType: row.habit_type,
    durationSeconds: row.duration_seconds,
    value: row.value,
    notes: row.notes,
    completedAt: row.completed_at,
  };
}

export async function insertHabitLog(
  log: Omit<HabitLog, 'id'>,
  db?: SQLite.SQLiteDatabase
): Promise<number> {
  const database = db ?? (await getDatabase());
  const result = await database.runAsync(
    `INSERT INTO habit_logs (
      date, habit_type, duration_seconds, value, notes, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      log.date,
      log.habitType,
      log.durationSeconds,
      log.value ?? null,
      log.notes ?? null,
      log.completedAt ?? new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
}

export async function getHabitLogsByDate(
  date: string,
  db?: SQLite.SQLiteDatabase
): Promise<HabitLog[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<RawHabitLogRow>(
    `SELECT * FROM habit_logs WHERE date = ? ORDER BY completed_at ASC`,
    [date]
  );
  return rows.map(mapRawHabitLog);
}

export async function getHabitLogsByType(
  habitType: string,
  limit: number = 50,
  db?: SQLite.SQLiteDatabase
): Promise<HabitLog[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<RawHabitLogRow>(
    `SELECT * FROM habit_logs WHERE habit_type = ? ORDER BY completed_at DESC LIMIT ?`,
    [habitType, limit]
  );
  return rows.map(mapRawHabitLog);
}

// -------------------------------------------------------------
// 14-Day Rolling Baseline Query Helper
// -------------------------------------------------------------

interface BaselineHrvAgg {
  avg_sdnn: number | null;
  avg_rmssd: number | null;
  scan_count: number;
}

interface BaselineWatchAgg {
  avg_resting_hr: number | null;
  avg_sleep_minutes: number | null;
  metrics_count: number;
}

/**
 * Computes a 14-day rolling baseline for SDNN, RMSSD, resting HR, and sleep duration.
 * @param beforeDate Optional ISO or YYYY-MM-DD anchor date (defaults to today).
 */
export async function get14DayBaseline(
  beforeDate?: string,
  db?: SQLite.SQLiteDatabase
): Promise<Rolling14DayBaseline> {
  const database = db ?? (await getDatabase());
  const anchor = beforeDate ? beforeDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // 1. Average SDNN & RMSSD from hrv_scans within the past 14 days
  const hrvAgg = await database.getFirstAsync<BaselineHrvAgg>(
    `SELECT 
       AVG(sdnn_ms) as avg_sdnn,
       AVG(rmssd_ms) as avg_rmssd,
       COUNT(*) as scan_count
     FROM hrv_scans
     WHERE date(timestamp) >= date(?, '-14 days')
       AND date(timestamp) <= date(?)`,
    [anchor, anchor]
  );

  // 2. Average Resting HR & Sleep duration from watch_daily_metrics within the past 14 days
  const watchAgg = await database.getFirstAsync<BaselineWatchAgg>(
    `SELECT 
       AVG(resting_hr) as avg_resting_hr,
       AVG(sleep_duration_minutes) as avg_sleep_minutes,
       COUNT(*) as metrics_count
     FROM watch_daily_metrics
     WHERE date >= date(?, '-14 days')
       AND date <= date(?)`,
    [anchor, anchor]
  );

  return {
    avgSdnnMs: hrvAgg?.avg_sdnn != null ? Math.round(hrvAgg.avg_sdnn * 10) / 10 : null,
    avgRmssdMs: hrvAgg?.avg_rmssd != null ? Math.round(hrvAgg.avg_rmssd * 10) / 10 : null,
    avgRestingHr: watchAgg?.avg_resting_hr != null ? Math.round(watchAgg.avg_resting_hr * 10) / 10 : null,
    avgSleepMinutes: watchAgg?.avg_sleep_minutes != null ? Math.round(watchAgg.avg_sleep_minutes) : null,
    scanCount: hrvAgg?.scan_count ?? 0,
    metricsCount: watchAgg?.metrics_count ?? 0,
  };
}

// -------------------------------------------------------------
// Habit Logging & Dashboard Query Helpers
// -------------------------------------------------------------

export async function deleteHabitLogByDateAndType(
  date: string,
  habitType: string,
  db?: SQLite.SQLiteDatabase
): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.runAsync(
    `DELETE FROM habit_logs WHERE date = ? AND habit_type = ?`,
    [date, habitType]
  );
}

export interface DailySdnnTrendPoint {
  date: string; // YYYY-MM-DD
  avgSdnn: number | null;
  scanCount: number;
}

/**
 * Returns a 14-day daily timeline of average SDNN values for charting.
 */
export async function get14DayDailySdnnTrends(
  anchorDate?: string,
  db?: SQLite.SQLiteDatabase
): Promise<DailySdnnTrendPoint[]> {
  const database = db ?? (await getDatabase());
  const anchor = anchorDate ? anchorDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const rows = await database.getAllAsync<{ date: string; avg_sdnn: number; scan_count: number }>(
    `SELECT 
       date(timestamp) as date,
       AVG(sdnn_ms) as avg_sdnn,
       COUNT(*) as scan_count
     FROM hrv_scans
     WHERE date(timestamp) >= date(?, '-13 days')
       AND date(timestamp) <= date(?)
     GROUP BY date(timestamp)
     ORDER BY date ASC`,
    [anchor, anchor]
  );

  const resultMap = new Map<string, { avgSdnn: number; scanCount: number }>();
  for (const row of rows) {
    resultMap.set(row.date, {
      avgSdnn: Math.round(row.avg_sdnn * 10) / 10,
      scanCount: row.scan_count,
    });
  }

  const trends: DailySdnnTrendPoint[] = [];
  const anchorD = new Date(anchor + 'T12:00:00Z');
  for (let i = 13; i >= 0; i--) {
    const d = new Date(anchorD);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const existing = resultMap.get(dateStr);
    trends.push({
      date: dateStr,
      avgSdnn: existing ? existing.avgSdnn : null,
      scanCount: existing ? existing.scanCount : 0,
    });
  }

  return trends;
}

export interface HabitCorrelationInsight {
  habitType: string;
  count: number;
  avgNextMorningSdnn: number;
  deltaFromBaseline: number; // e.g. -6.4 ms
  impactPercent: number; // e.g. -13%
}

/**
 * Calculates correlation between logged habits and next-morning SDNN vs baseline.
 */
export async function getHabitSdnnCorrelations(
  baselineSdnn?: number | null,
  db?: SQLite.SQLiteDatabase
): Promise<HabitCorrelationInsight[]> {
  const database = db ?? (await getDatabase());

  let baseSdnn = baselineSdnn;
  if (baseSdnn == null) {
    const agg = await database.getFirstAsync<{ avg_sdnn: number | null }>(
      `SELECT AVG(sdnn_ms) as avg_sdnn FROM hrv_scans`
    );
    baseSdnn = agg?.avg_sdnn ?? null;
  }
  if (!baseSdnn || baseSdnn <= 0) {
    return [];
  }

  const rows = await database.getAllAsync<{ habit_type: string; avg_next_sdnn: number; log_count: number }>(
    `SELECT 
       hl.habit_type,
       AVG(hs.sdnn_ms) as avg_next_sdnn,
       COUNT(DISTINCT hl.date) as log_count
     FROM habit_logs hl
     INNER JOIN hrv_scans hs 
       ON date(hs.timestamp) = date(hl.date, '+1 day')
     GROUP BY hl.habit_type
     HAVING COUNT(DISTINCT hl.date) >= 1`
  );

  return rows.map((r) => {
    const avgNext = Math.round(r.avg_next_sdnn * 10) / 10;
    const delta = Math.round((avgNext - (baseSdnn as number)) * 10) / 10;
    const pct = Math.round((delta / (baseSdnn as number)) * 100);
    return {
      habitType: r.habit_type,
      count: r.log_count,
      avgNextMorningSdnn: avgNext,
      deltaFromBaseline: delta,
      impactPercent: pct,
    };
  });
}

