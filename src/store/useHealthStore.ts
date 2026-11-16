/**
 * HushBeat - Health & Biometric State Store (Zustand)
 *
 * Manages active PPG scanning state, real-time waveform streaming,
 * latest HRV metrics, 14-day baseline, and breathing session scans.
 */

import { create } from 'zustand';
import {
  HrvScan,
  Rolling14DayBaseline,
  WatchDailyMetrics,
  get14DayBaseline,
  getHrvScans,
  getLatestHrvScan,
  insertHrvScan,
} from '../db/database';

export type ScanType = 'morning' | 'pre_breathing' | 'post_breathing' | 'spot_check';

export interface HealthState {
  // Scanning state
  isScanning: boolean;
  isPaused: boolean;
  scanType: ScanType;
  elapsedSeconds: number;
  targetDurationSeconds: number;
  liveBpm: number;
  liveSqi: number;
  isFingerDetected: boolean;
  sqiReasons: string[];
  liveWaveform: number[]; // rolling window of filtered PPG points (e.g. 100 points)

  // HRV & Biometric results
  latestScan: HrvScan | null;
  preBreathingScan: HrvScan | null;
  postBreathingScan: HrvScan | null;
  recentScans: HrvScan[];
  baseline: Rolling14DayBaseline | null;
  todayWatchMetrics: WatchDailyMetrics | null;

  // Actions
  startScan: (type?: ScanType) => void;
  stopScan: () => void;
  pauseScan: (reason?: string) => void;
  resumeScan: () => void;
  tickElapsed: () => void;
  updateLiveMetrics: (
    bpm: number,
    sqi: number,
    waveformSample: number,
    isFingerOn: boolean,
    reasons?: string[]
  ) => void;
  saveCompletedScan: (scanData: Omit<HrvScan, 'id' | 'createdAt'>) => Promise<HrvScan>;
  loadInitialData: () => Promise<void>;
  setPreBreathingScan: (scan: HrvScan) => void;
  setPostBreathingScan: (scan: HrvScan) => void;
  resetScanState: () => void;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  isScanning: false,
  isPaused: false,
  scanType: 'morning',
  elapsedSeconds: 0,
  targetDurationSeconds: 60,
  liveBpm: 0,
  liveSqi: 0,
  isFingerDetected: false,
  sqiReasons: [],
  liveWaveform: [],

  latestScan: null,
  preBreathingScan: null,
  postBreathingScan: null,
  recentScans: [],
  baseline: null,
  todayWatchMetrics: null,

  startScan: (type = 'morning') => {
    set({
      isScanning: true,
      isPaused: false,
      scanType: type,
      elapsedSeconds: 0,
      liveBpm: 0,
      liveSqi: 0,
      isFingerDetected: false,
      sqiReasons: [],
      liveWaveform: [],
    });
  },

  stopScan: () => {
    set({
      isScanning: false,
      isPaused: false,
    });
  },

  pauseScan: (reason?: string) => {
    const currentReasons = get().sqiReasons;
    const updatedReasons = reason
      ? Array.from(new Set([...currentReasons, reason]))
      : currentReasons;
    set({ isPaused: true, sqiReasons: updatedReasons });
  },

  resumeScan: () => {
    set({ isPaused: false });
  },

  tickElapsed: () => {
    const { elapsedSeconds, targetDurationSeconds, isPaused, isScanning } = get();
    if (isScanning && !isPaused && elapsedSeconds < targetDurationSeconds) {
      set({ elapsedSeconds: elapsedSeconds + 1 });
    }
  },

  updateLiveMetrics: (bpm, sqi, waveformSample, isFingerOn, reasons = []) => {
    const currentWaveform = get().liveWaveform;
    const maxPoints = 80; // Keep rolling window for smooth visualization
    const updatedWaveform = [...currentWaveform, waveformSample];
    if (updatedWaveform.length > maxPoints) {
      updatedWaveform.shift();
    }

    set({
      liveBpm: bpm > 0 ? bpm : get().liveBpm,
      liveSqi: sqi,
      isFingerDetected: isFingerOn,
      sqiReasons: reasons,
      liveWaveform: updatedWaveform,
      isPaused: sqi < 60, // Auto-pause if SQI drops below 60% gate
    });
  },

  saveCompletedScan: async (scanData) => {
    const newId = await insertHrvScan(scanData);
    const completeScan: HrvScan = {
      ...scanData,
      id: newId,
      createdAt: new Date().toISOString(),
    };

    set((state) => {
      const updatedRecent = [completeScan, ...state.recentScans.slice(0, 19)];
      let preScan = state.preBreathingScan;
      let postScan = state.postBreathingScan;

      if (scanData.notes?.includes('Pre-Breathing') || state.scanType === 'pre_breathing') {
        preScan = completeScan;
      } else if (scanData.notes?.includes('Post-Breathing') || state.scanType === 'post_breathing') {
        postScan = completeScan;
      }

      return {
        isScanning: false,
        isPaused: false,
        latestScan: completeScan,
        preBreathingScan: preScan,
        postBreathingScan: postScan,
        recentScans: updatedRecent,
      };
    });

    // Refresh baseline asynchronously
    try {
      const newBaseline = await get14DayBaseline();
      set({ baseline: newBaseline });
    } catch (e) {
      console.warn('Failed to refresh 14-day baseline:', e);
    }

    return completeScan;
  },

  loadInitialData: async () => {
    try {
      const [latest, recent, baseline] = await Promise.all([
        getLatestHrvScan(),
        getHrvScans(20, 0),
        get14DayBaseline(),
      ]);

      set({
        latestScan: latest,
        recentScans: recent,
        baseline,
      });
    } catch (err) {
      console.warn('Error loading initial health data:', err);
    }
  },

  setPreBreathingScan: (scan: HrvScan) => set({ preBreathingScan: scan }),
  setPostBreathingScan: (scan: HrvScan) => set({ postBreathingScan: scan }),

  resetScanState: () => {
    set({
      isScanning: false,
      isPaused: false,
      elapsedSeconds: 0,
      liveBpm: 0,
      liveSqi: 0,
      isFingerDetected: false,
      sqiReasons: [],
      liveWaveform: [],
    });
  },
}));
