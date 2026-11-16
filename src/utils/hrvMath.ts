/**
 * HushBeat - HRV Mathematical Processing & Metric Extraction
 *
 * Pure TypeScript module with ZERO React Native UI imports.
 *
 * Engineering rules:
 * - Parabolic peak interpolation to extract sub-frame / millisecond peak timing.
 * - Signal Quality Index (SQI) gate — reject/flag windows with poor signal.
 * - R-R outlier rejection: drop intervals that differ by >20% from the previous
 *   accepted interval (or local median) before computing SDNN and RMSSD.
 * - Compute avgBpm, sdnnMs, rmssdMs, stressScore (0–100), and readinessScore (0–100).
 */

import { applyBandpassFilter, checkSignalQuality, SQIResult } from './ppgFilter';

export interface InterpolatedPeak {
  index: number; // Sub-sample fractional index (e.g. 14.32)
  timeMs: number; // Interpolated timestamp in milliseconds
  amplitude: number; // Interpolated peak height
}

export interface BaselineData {
  avgSdnnMs: number | null;
  avgRmssdMs: number | null;
  avgRestingHr: number | null;
  avgSleepMinutes: number | null;
}

export interface TodayBiometrics {
  restingHr?: number | null;
  sleepMinutes?: number | null;
}

export interface HrvAnalysisResult {
  avgBpm: number;
  sdnnMs: number;
  rmssdMs: number;
  stressScore: number; // 0 to 100 (higher = more stressed)
  readinessScore: number; // 0 to 100 (higher = better recovered)
  sqi: SQIResult;
  peaksCount: number;
  acceptedIntervalsCount: number;
  rejectedIntervalsCount: number;
  rawRrIntervals: number[];
  acceptedRrIntervals: number[];
}

/**
 * Calculates sub-sample peak location and amplitude using 3-point parabolic interpolation.
 *
 * @param y0 Previous sample amplitude y[i-1]
 * @param y1 Peak candidate amplitude y[i]
 * @param y2 Next sample amplitude y[i+1]
 * @param centerIndex Integer index i of candidate peak
 * @param centerTimeMs Timestamp in ms at index i
 * @param samplePeriodMs Duration in ms of one sample interval
 */
export function parabolicPeakInterpolation(
  y0: number,
  y1: number,
  y2: number,
  centerIndex: number,
  centerTimeMs: number,
  samplePeriodMs: number
): InterpolatedPeak {
  const denominator = 2 * (y0 - 2 * y1 + y2);

  // If flat-topped or non-concave downward, fall back to center sample
  if (Math.abs(denominator) < 1e-7 || denominator >= 0) {
    return {
      index: centerIndex,
      timeMs: centerTimeMs,
      amplitude: y1,
    };
  }

  // Fractional offset from sample i (-0.5 to +0.5)
  const delta = (y0 - y2) / denominator;
  const clampedDelta = Math.max(-0.5, Math.min(0.5, delta));

  const peakIndex = centerIndex + clampedDelta;
  const peakTimeMs = centerTimeMs + clampedDelta * samplePeriodMs;
  const peakAmplitude = y1 - ((y0 - y2) * (y0 - y2)) / (8 * (y0 - 2 * y1 + y2));

  return {
    index: Math.round(peakIndex * 1000) / 1000,
    timeMs: Math.round(peakTimeMs * 10) / 10,
    amplitude: peakAmplitude,
  };
}

/**
 * Detects systolic peaks in filtered PPG signal using adaptive thresholding
 * and parabolic peak interpolation.
 *
 * @param filteredSamples 0.5–4.0 Hz bandpass filtered samples.
 * @param timestampsMs Millisecond timestamps for each sample (or generated via fs).
 * @param fs Sampling rate in Hz.
 */
export function detectPpgPeaks(
  filteredSamples: number[],
  timestampsMs?: number[],
  fs: number = 30
): InterpolatedPeak[] {
  const n = filteredSamples.length;
  if (n < 5) return [];

  const samplePeriodMs = 1000 / fs;
  const times = timestampsMs && timestampsMs.length === n
    ? timestampsMs
    : Array.from({ length: n }, (_, i) => i * samplePeriodMs);

  // Compute positive peak threshold (20% of max amplitude)
  let maxAmp = -Infinity;
  for (let i = 0; i < n; i++) {
    if (filteredSamples[i] > maxAmp) maxAmp = filteredSamples[i];
  }
  const threshold = Math.max(0.01, maxAmp * 0.25);

  const minPeakDistanceMs = 250; // Minimum RR = 250ms (corresponds to 240 bpm)
  const peaks: InterpolatedPeak[] = [];
  let lastPeakTimeMs = -Infinity;

  for (let i = 1; i < n - 1; i++) {
    const prev = filteredSamples[i - 1];
    const curr = filteredSamples[i];
    const next = filteredSamples[i + 1];

    // Local peak condition
    if (curr > prev && curr >= next && curr > threshold) {
      const peak = parabolicPeakInterpolation(
        prev,
        curr,
        next,
        i,
        times[i],
        samplePeriodMs
      );

      // Enforce physiological refractory period (250 ms)
      if (peak.timeMs - lastPeakTimeMs >= minPeakDistanceMs) {
        peaks.push(peak);
        lastPeakTimeMs = peak.timeMs;
      } else if (peaks.length > 0 && peak.amplitude > peaks[peaks.length - 1].amplitude) {
        // Replace previous peak if current is within refractory window but stronger
        peaks[peaks.length - 1] = peak;
        lastPeakTimeMs = peak.timeMs;
      }
    }
  }

  return peaks;
}

/**
 * Calculates rolling median of an array of numbers.
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Extracts R-R intervals and rejects outliers deviating by > 20%
 * from the rolling median of accepted intervals.
 *
 * @param peaks Array of detected interpolated peaks.
 */
export function extractAndFilterRrIntervals(peaks: InterpolatedPeak[]): {
  rawIntervals: number[];
  acceptedIntervals: number[];
  rejectedCount: number;
} {
  if (peaks.length < 2) {
    return { rawIntervals: [], acceptedIntervals: [], rejectedCount: 0 };
  }

  const rawIntervals: number[] = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    const rr = Math.round((peaks[i + 1].timeMs - peaks[i].timeMs) * 10) / 10;
    rawIntervals.push(rr);
  }

  // Pre-filter physiologically valid intervals (250ms to 2000ms, i.e. 30 to 240 bpm)
  const validPhysiological = rawIntervals.filter((rr) => rr >= 250 && rr <= 2000);
  if (validPhysiological.length === 0) {
    return { rawIntervals, acceptedIntervals: [], rejectedCount: rawIntervals.length };
  }

  // Compute global median of valid intervals as initial reference to prevent first-sample outlier poisoning
  const globalMedian = calculateMedian(validPhysiological);

  const acceptedIntervals: number[] = [];
  let rejectedCount = 0;

  for (let i = 0; i < rawIntervals.length; i++) {
    const rr = rawIntervals[i];

    // Physiological absolute limits: 250 ms (240 bpm) to 2000 ms (30 bpm)
    if (rr < 250 || rr > 2000) {
      rejectedCount++;
      continue;
    }

    // Determine reference: rolling median of recent accepted intervals, or global median
    const reference = acceptedIntervals.length >= 3
      ? calculateMedian(acceptedIntervals.slice(-5))
      : globalMedian;

    // Rule: reject intervals differing by > 20% from rolling reference
    const deviationFraction = Math.abs(rr - reference) / reference;
    if (deviationFraction <= 0.20) {
      acceptedIntervals.push(rr);
    } else {
      rejectedCount++;
    }
  }

  return {
    rawIntervals,
    acceptedIntervals,
    rejectedCount,
  };
}

/**
 * Calculates SDNN (Standard Deviation of NN intervals) in milliseconds.
 */
export function calculateSdnn(rrIntervals: number[]): number {
  if (rrIntervals.length < 2) return 0;
  const mean = rrIntervals.reduce((sum, v) => sum + v, 0) / rrIntervals.length;
  let sumSquaredDiff = 0;
  for (const rr of rrIntervals) {
    const diff = rr - mean;
    sumSquaredDiff += diff * diff;
  }
  return Math.round(Math.sqrt(sumSquaredDiff / (rrIntervals.length - 1)) * 10) / 10;
}

/**
 * Calculates RMSSD (Root Mean Square of Successive Differences) in milliseconds.
 */
export function calculateRmssd(rrIntervals: number[]): number {
  if (rrIntervals.length < 2) return 0;
  let sumSquaredDiff = 0;
  for (let i = 0; i < rrIntervals.length - 1; i++) {
    const diff = rrIntervals[i + 1] - rrIntervals[i];
    sumSquaredDiff += diff * diff;
  }
  return Math.round(Math.sqrt(sumSquaredDiff / (rrIntervals.length - 1)) * 10) / 10;
}

/**
 * Calculates Average BPM from accepted R-R intervals.
 */
export function calculateAvgBpm(rrIntervals: number[]): number {
  if (rrIntervals.length === 0) return 0;
  const meanRr = rrIntervals.reduce((sum, v) => sum + v, 0) / rrIntervals.length;
  if (meanRr <= 0) return 0;
  return Math.round((60000 / meanRr) * 10) / 10;
}

/**
 * Computes a standardized 0–100 Stress Score.
 * 0 = deep relaxation / strong parasympathetic tone.
 * 100 = severe sympathetic arousal / acute fatigue.
 *
 * @param rmssdMs RMSSD value in milliseconds.
 * @param avgBpm Heart rate in beats per minute.
 */
export function calculateStressScore(rmssdMs: number, avgBpm: number): number {
  if (rmssdMs <= 0) return 85;

  // RMSSD component: typical healthy resting range is 15 ms to 95 ms
  // High RMSSD = low stress; Low RMSSD = high stress
  const clampedRmssd = Math.max(10, Math.min(100, rmssdMs));
  const hrvStress = ((100 - clampedRmssd) / 90) * 100;

  // BPM component: resting bpm above 80 adds stress; below 65 indicates calm
  const clampedBpm = Math.max(50, Math.min(110, avgBpm));
  const bpmStress = ((clampedBpm - 50) / 60) * 100;

  // Weighted combo: 75% HRV parasympathetic balance, 25% cardiac rate
  const composite = 0.75 * hrvStress + 0.25 * bpmStress;
  return Math.max(0, Math.min(100, Math.round(composite)));
}

/**
 * Computes a standardized 0–100 Readiness Score.
 * 0 = exhausted / needs rest.
 * 100 = peak autonomic recovery / ready for high strain.
 *
 * Compares today's SDNN/RMSSD, resting HR, and sleep against 14-day rolling baseline.
 * If baseline is missing (first runs), defaults to clinical population norms.
 *
 * @param todaySdnn Today's SDNN in ms.
 * @param todayRmssd Today's RMSSD in ms.
 * @param baseline Optional 14-day rolling baseline averages.
 * @param todayBiometrics Optional today's resting HR and sleep duration.
 */
export function calculateReadinessScore(
  todaySdnn: number,
  todayRmssd: number,
  baseline?: BaselineData | null,
  todayBiometrics?: TodayBiometrics | null
): number {
  // 1. HRV Component (50% weight)
  const refRmssd = baseline?.avgRmssdMs && baseline.avgRmssdMs > 10 ? baseline.avgRmssdMs : 42;
  const rmssdRatio = todayRmssd > 0 ? todayRmssd / refRmssd : 0.5;

  // Baseline ratio mapping: 1.0 = 75 score, 1.3+ = 95-100, 0.7 = 50, <= 0.5 = 25
  let hrvScore = 75 + (rmssdRatio - 1.0) * 70;
  hrvScore = Math.max(10, Math.min(100, hrvScore));

  // 2. Resting Heart Rate Component (25% weight)
  let rhrScore = 75; // neutral fallback
  const todayRhr = todayBiometrics?.restingHr;
  const refRhr = baseline?.avgRestingHr && baseline.avgRestingHr > 35 ? baseline.avgRestingHr : 65;

  if (todayRhr && todayRhr > 30) {
    const rhrDiff = todayRhr - refRhr;
    // Lower or matching resting HR is good; elevated resting HR indicates strain/sickness
    rhrScore = 80 - rhrDiff * 4;
    rhrScore = Math.max(15, Math.min(100, rhrScore));
  }

  // 3. Sleep Component (25% weight)
  let sleepScore = 75; // neutral fallback
  const todaySleepMin = todayBiometrics?.sleepMinutes;
  const refSleepMin = baseline?.avgSleepMinutes && baseline.avgSleepMinutes > 180 ? baseline.avgSleepMinutes : 480;

  if (todaySleepMin && todaySleepMin > 0) {
    const sleepRatio = todaySleepMin / refSleepMin;
    // 100% of baseline sleep = 85 score; 115% = 100; 70% = 50
    sleepScore = 85 + (sleepRatio - 1.0) * 75;
    sleepScore = Math.max(10, Math.min(100, sleepScore));
  }

  const finalScore = 0.5 * hrvScore + 0.25 * rhrScore + 0.25 * sleepScore;
  return Math.max(0, Math.min(100, Math.round(finalScore)));
}

/**
 * Complete end-to-end HRV processing pipeline for a camera PPG measurement window.
 *
 * @param rawRedSamples Array of raw mean red brightness values.
 * @param timestampsMs Array of millisecond timestamps (or undefined to derive from fs).
 * @param fs Sampling rate in Hz (default 30).
 * @param baseline Optional 14-day rolling baseline for readiness scoring.
 * @param todayBiometrics Optional today's resting HR and sleep duration.
 */
export function processPpgForHrv(
  rawRedSamples: number[],
  timestampsMs?: number[],
  fs: number = 30,
  baseline?: BaselineData | null,
  todayBiometrics?: TodayBiometrics | null
): HrvAnalysisResult {
  // 1. SQI Gate
  const sqi = checkSignalQuality(rawRedSamples, fs);

  // If signal quality is unacceptable, return baseline degraded metrics
  if (!sqi.isAcceptable) {
    return {
      avgBpm: 0,
      sdnnMs: 0,
      rmssdMs: 0,
      stressScore: 90,
      readinessScore: 20,
      sqi,
      peaksCount: 0,
      acceptedIntervalsCount: 0,
      rejectedIntervalsCount: 0,
      rawRrIntervals: [],
      acceptedRrIntervals: [],
    };
  }

  // 2. 0.5–4.0 Hz Bandpass Filter (Zero-Phase)
  const filtered = applyBandpassFilter(rawRedSamples, fs, true);

  // 3. Parabolic Peak Detection
  const peaks = detectPpgPeaks(filtered, timestampsMs, fs);

  // 4. Outlier Rejection (>20% rolling median rule)
  const { rawIntervals, acceptedIntervals, rejectedCount } = extractAndFilterRrIntervals(peaks);

  // 5. Biometric Metrics Extraction
  const avgBpm = calculateAvgBpm(acceptedIntervals);
  const sdnnMs = calculateSdnn(acceptedIntervals);
  const rmssdMs = calculateRmssd(acceptedIntervals);
  const stressScore = calculateStressScore(rmssdMs, avgBpm);
  const readinessScore = calculateReadinessScore(sdnnMs, rmssdMs, baseline, todayBiometrics);

  return {
    avgBpm,
    sdnnMs,
    rmssdMs,
    stressScore,
    readinessScore,
    sqi,
    peaksCount: peaks.length,
    acceptedIntervalsCount: acceptedIntervals.length,
    rejectedIntervalsCount: rejectedCount,
    rawRrIntervals: rawIntervals,
    acceptedRrIntervals: acceptedIntervals,
  };
}
