/**
 * HushBeat - Unit Tests for Biometric Math & HRV Algorithms
 *
 * Covers:
 * - Parabolic peak interpolation
 * - 0.5–4.0 Hz bandpass filtering
 * - Signal Quality Index (SQI) gating: clipping, motion spikes, flatlines
 * - R-R interval extraction and >20% outlier rejection
 * - SDNN, RMSSD, avgBpm, stressScore, and readinessScore calculation
 */

import {
  applyBandpassFilter,
  checkSignalQuality,
  PPGBandpassFilter,
} from '../ppgFilter';
import {
  detectPpgPeaks,
  extractAndFilterRrIntervals,
  parabolicPeakInterpolation,
  calculateSdnn,
  calculateRmssd,
  calculateAvgBpm,
  calculateStressScore,
  calculateReadinessScore,
  processPpgForHrv,
} from '../hrvMath';

describe('Biometric Math & HRV Algorithms', () => {
  describe('Parabolic Peak Interpolation', () => {
    it('accurately finds sub-sample peak for a symmetric quadratic curve', () => {
      // True peak at index 5.0 with value 10
      // y = - (x - 5)^2 + 10
      // y(4) = 9, y(5) = 10, y(6) = 9
      const peak = parabolicPeakInterpolation(9, 10, 9, 5, 500, 100);
      expect(peak.index).toBe(5);
      expect(peak.timeMs).toBe(500);
      expect(peak.amplitude).toBe(10);
    });

    it('accurately interpolates peak offset between samples', () => {
      // True peak shifted towards right (e.g. between 5 and 6)
      // y(4) = 7, y(5) = 10, y(6) = 9.5
      const peak = parabolicPeakInterpolation(7, 10, 9.5, 5, 500, 100);
      expect(peak.index).toBeGreaterThan(5);
      expect(peak.index).toBeLessThan(5.5);
      expect(peak.timeMs).toBeGreaterThan(500);
      expect(peak.amplitude).toBeGreaterThan(10);
    });

    it('gracefully handles flat or inverted top', () => {
      const peak = parabolicPeakInterpolation(10, 10, 10, 3, 300, 100);
      expect(peak.index).toBe(3);
      expect(peak.timeMs).toBe(300);
    });
  });

  describe('PPG Bandpass Filtering (0.5–4.0 Hz)', () => {
    it('attenuates high-frequency tremor (> 5 Hz) and DC baseline drift (< 0.2 Hz)', () => {
      const fs = 30; // 30 fps
      const durationSec = 10;
      const n = fs * durationSec;
      const samples: number[] = [];

      for (let i = 0; i < n; i++) {
        const t = i / fs;
        // 1 Hz cardiac signal (60 bpm) + DC offset 150 + 0.1 Hz baseline drift + 10 Hz hand tremor
        const cardiac = 8 * Math.sin(2 * Math.PI * 1.0 * t);
        const dcOffset = 150;
        const baselineDrift = 20 * Math.sin(2 * Math.PI * 0.1 * t);
        const tremor = 5 * Math.sin(2 * Math.PI * 10.0 * t);
        samples.push(dcOffset + cardiac + baselineDrift + tremor);
      }

      const filtered = applyBandpassFilter(samples, fs, true);

      // Filtered output should be centered around 0 (DC removed)
      const meanFiltered = filtered.reduce((a, b) => a + b, 0) / filtered.length;
      expect(Math.abs(meanFiltered)).toBeLessThan(1.0);

      // Filtered signal retains cardiac pulsatile amplitude (~8)
      const maxVal = Math.max(...filtered.slice(fs, n - fs)); // exclude boundary edges
      expect(maxVal).toBeGreaterThan(5);
      expect(maxVal).toBeLessThan(12);
    });

    it('works in real-time streaming mode via PPGBandpassFilter', () => {
      const filter = new PPGBandpassFilter(30, 0.5, 4.0);
      const fs = 30;
      const outputs: number[] = [];

      for (let i = 0; i < 90; i++) {
        const t = i / fs;
        const val = 120 + 10 * Math.sin(2 * Math.PI * 1.2 * t);
        outputs.push(filter.process(val));
      }

      expect(outputs.length).toBe(90);
      expect(Number.isFinite(outputs[89])).toBe(true);
    });
  });

  describe('Signal Quality Index (SQI) Gate', () => {
    it('accepts clean pulsatile signal within physiological brightness range', () => {
      const fs = 30;
      const n = 150; // 5 seconds
      const cleanSamples: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        // Mean brightness 140, cardiac oscillation amplitude 6, smooth derivative
        cleanSamples.push(140 + 6 * Math.sin(2 * Math.PI * 1.2 * t));
      }

      const sqi = checkSignalQuality(cleanSamples, fs);
      expect(sqi.isAcceptable).toBe(true);
      expect(sqi.sqi).toBeGreaterThanOrEqual(60);
      expect(sqi.isClipped).toBe(false);
      expect(sqi.isMotionDistorted).toBe(false);
    });

    it('rejects saturated / overexposed signal (finger pressed too hard)', () => {
      const saturatedSamples = new Array(150).fill(255);
      const sqi = checkSignalQuality(saturatedSamples, 30);
      expect(sqi.isAcceptable).toBe(false);
      expect(sqi.isClipped).toBe(true);
      expect(sqi.sqi).toBeLessThan(60);
      expect(sqi.reasons.some((r) => r.includes('saturated'))).toBe(true);
    });

    it('rejects dark / finger liftoff signal', () => {
      const darkSamples = new Array(150).fill(12);
      const sqi = checkSignalQuality(darkSamples, 30);
      expect(sqi.isAcceptable).toBe(false);
      expect(sqi.isClipped).toBe(true);
      expect(sqi.sqi).toBeLessThan(60);
      expect(sqi.reasons.some((r) => r.includes('dark'))).toBe(true);
    });

    it('rejects signal with sudden motion spikes', () => {
      const fs = 30;
      const n = 150;
      const motionSamples: number[] = [];
      for (let i = 0; i < n; i++) {
        motionSamples.push(130 + 5 * Math.sin(2 * Math.PI * 1.0 * (i / fs)));
      }
      // Inject wild sudden movement spikes (jump > 30 units between adjacent frames)
      motionSamples[40] = 190;
      motionSamples[41] = 80;

      const sqi = checkSignalQuality(motionSamples, fs);
      expect(sqi.isAcceptable).toBe(false);
      expect(sqi.isMotionDistorted).toBe(true);
      expect(sqi.reasons.some((r) => r.includes('motion'))).toBe(true);
    });

    it('rejects completely flatline signal (no pulse flow)', () => {
      const flatlineSamples = new Array(150).fill(140);
      const sqi = checkSignalQuality(flatlineSamples, 30);
      expect(sqi.isAcceptable).toBe(false);
      expect(sqi.reasons.some((r) => r.includes('flatline'))).toBe(true);
    });
  });

  describe('Peak Detection & R-R Interval Extraction', () => {
    it('detects clean synthetic pulse peaks at 60 bpm (1000 ms intervals)', () => {
      const fs = 30;
      const durationSec = 10;
      const n = fs * durationSec;
      const cleanWave: number[] = [];
      const times: number[] = [];

      for (let i = 0; i < n; i++) {
        const tMs = (i / fs) * 1000;
        times.push(tMs);
        // Pure 1 Hz sine wave (60 bpm)
        cleanWave.push(10 * Math.sin(2 * Math.PI * 1.0 * (i / fs)));
      }

      const peaks = detectPpgPeaks(cleanWave, times, fs);
      // At 60 bpm for 10s, should have ~9-10 peaks
      expect(peaks.length).toBeGreaterThanOrEqual(9);
      expect(peaks.length).toBeLessThanOrEqual(11);

      const { acceptedIntervals } = extractAndFilterRrIntervals(peaks);
      expect(acceptedIntervals.length).toBeGreaterThanOrEqual(8);

      for (const rr of acceptedIntervals) {
        // Sample period is 33.3ms, parabolic interpolation gets timing near 1000ms
        expect(rr).toBeGreaterThan(950);
        expect(rr).toBeLessThan(1050);
      }

      const avgBpm = calculateAvgBpm(acceptedIntervals);
      expect(Math.round(avgBpm)).toBe(60);
    });

    it('rejects ectopic and noisy R-R intervals deviating by > 20%', () => {
      // Create artificial peak series:
      // Baseline intervals: 800 ms (75 bpm)
      // Peaks at: 0, 800, 1600, 2400, [noise jump to 3600: +50%], 4400, [noise jump to 4800: -50%], 5600
      const peaks = [
        { index: 0, timeMs: 0, amplitude: 10 },
        { index: 24, timeMs: 800, amplitude: 10 },
        { index: 48, timeMs: 1605, amplitude: 10 },
        { index: 72, timeMs: 2400, amplitude: 10 },
        { index: 108, timeMs: 3600, amplitude: 10 }, // delta = 1200ms (+50% -> OUTLIER)
        { index: 132, timeMs: 4400, amplitude: 10 }, // delta = 800ms (normal)
        { index: 144, timeMs: 4800, amplitude: 10 }, // delta = 400ms (-50% -> OUTLIER)
        { index: 168, timeMs: 5610, amplitude: 10 }, // delta = 810ms (normal)
      ];

      const { rawIntervals, acceptedIntervals, rejectedCount } = extractAndFilterRrIntervals(peaks);

      expect(rawIntervals).toEqual([800, 805, 795, 1200, 800, 400, 810]);
      expect(rejectedCount).toBe(2); // 1200ms and 400ms dropped
      expect(acceptedIntervals).toEqual([800, 805, 795, 800, 810]);
    });
  });

  describe('SDNN & RMSSD Calculations', () => {
    it('computes accurate SDNN and RMSSD for known interval differences', () => {
      // Intervals: 800, 840, 800, 850, 810
      // Mean = 820
      // Diffs from mean: -20, +20, -20, +30, -10 -> sum sq diffs = 400 + 400 + 400 + 900 + 100 = 2200
      // Variance = 2200 / 4 = 550 -> SDNN = sqrt(550) ≈ 23.45 ms
      // Successive diffs: 840-800=40, 800-840=-40, 850-800=50, 810-850=-40
      // Sq diffs: 1600 + 1600 + 2500 + 1600 = 7300
      // RMSSD = sqrt(7300 / 4) = sqrt(1825) ≈ 42.72 ms
      const rr = [800, 840, 800, 850, 810];
      const sdnn = calculateSdnn(rr);
      const rmssd = calculateRmssd(rr);

      expect(sdnn).toBeCloseTo(23.5, 0);
      expect(rmssd).toBeCloseTo(42.7, 0);
    });

    it('returns 0 for empty or single-element array', () => {
      expect(calculateSdnn([])).toBe(0);
      expect(calculateSdnn([800])).toBe(0);
      expect(calculateRmssd([])).toBe(0);
      expect(calculateRmssd([800])).toBe(0);
    });
  });

  describe('Stress Score Calculation', () => {
    it('assigns low stress score for high RMSSD and calm heart rate', () => {
      // High RMSSD (85ms) + relaxed HR (58 bpm)
      const stress = calculateStressScore(85, 58);
      expect(stress).toBeLessThanOrEqual(25);
    });

    it('assigns high stress score for low RMSSD and elevated heart rate', () => {
      // Low RMSSD (14ms) + high HR (98 bpm)
      const stress = calculateStressScore(14, 98);
      expect(stress).toBeGreaterThanOrEqual(80);
    });

    it('clamps stress score strictly within 0 to 100', () => {
      expect(calculateStressScore(200, 40)).toBeGreaterThanOrEqual(0);
      expect(calculateStressScore(5, 140)).toBeLessThanOrEqual(100);
    });
  });

  describe('Readiness Score Calculation', () => {
    const baseline = {
      avgSdnnMs: 50,
      avgRmssdMs: 45,
      avgRestingHr: 62,
      avgSleepMinutes: 460,
    };

    it('gives high readiness when HRV is above baseline, resting HR is low, and sleep is sufficient', () => {
      const readiness = calculateReadinessScore(
        65, // SDNN elevated
        60, // RMSSD +33% above baseline
        baseline,
        { restingHr: 58, sleepMinutes: 480 }
      );
      expect(readiness).toBeGreaterThanOrEqual(85);
      expect(readiness).toBeLessThanOrEqual(100);
    });

    it('gives low readiness when HRV is suppressed, resting HR is elevated, and sleep is low', () => {
      const readiness = calculateReadinessScore(
        25, // SDNN low
        20, // RMSSD -55% below baseline
        baseline,
        { restingHr: 76, sleepMinutes: 300 } // RHR elevated +14, sleep only 5h
      );
      expect(readiness).toBeLessThanOrEqual(45);
      expect(readiness).toBeGreaterThanOrEqual(0);
    });

    it('gracefully handles missing baseline by falling back to clinical norms', () => {
      const readiness = calculateReadinessScore(45, 42, null, null);
      // Matching 42ms clinical norm with neutral context -> healthy recovery around 75
      expect(readiness).toBeGreaterThanOrEqual(65);
      expect(readiness).toBeLessThanOrEqual(85);
    });
  });

  describe('Full End-to-End Pipeline (processPpgForHrv)', () => {
    it('runs entire pipeline cleanly on valid simulated PPG window', () => {
      const fs = 30;
      const durationSec = 15;
      const n = fs * durationSec;
      const rawRedSamples: number[] = [];
      const times: number[] = [];

      for (let i = 0; i < n; i++) {
        const t = i / fs;
        times.push(t * 1000);
        // Realistic PPG pulse at ~72 bpm (1.2 Hz) with slight 0.2 Hz respiratory modulation
        const basePulse = 8 * Math.sin(2 * Math.PI * 1.2 * t);
        const dicroticNotch = 2 * Math.sin(2 * Math.PI * 2.4 * t);
        rawRedSamples.push(150 + basePulse + dicroticNotch);
      }

      const result = processPpgForHrv(rawRedSamples, times, fs);

      expect(result.sqi.isAcceptable).toBe(true);
      expect(result.avgBpm).toBeGreaterThan(65);
      expect(result.avgBpm).toBeLessThan(80);
      expect(result.acceptedIntervalsCount).toBeGreaterThanOrEqual(10);
      expect(result.rejectedIntervalsCount).toBeLessThan(result.acceptedIntervalsCount);
      expect(result.sdnnMs).toBeGreaterThanOrEqual(0);
      expect(result.rmssdMs).toBeGreaterThanOrEqual(0);
      expect(result.stressScore).toBeGreaterThanOrEqual(0);
      expect(result.stressScore).toBeLessThanOrEqual(100);
      expect(result.readinessScore).toBeGreaterThanOrEqual(0);
      expect(result.readinessScore).toBeLessThanOrEqual(100);
    });

    it('safely gates out corrupted / unviable input', () => {
      const badSignal = new Array(150).fill(255); // completely clipped
      const result = processPpgForHrv(badSignal, undefined, 30);

      expect(result.sqi.isAcceptable).toBe(false);
      expect(result.avgBpm).toBe(0);
      expect(result.sdnnMs).toBe(0);
      expect(result.rmssdMs).toBe(0);
      expect(result.acceptedIntervalsCount).toBe(0);
    });
  });
});
