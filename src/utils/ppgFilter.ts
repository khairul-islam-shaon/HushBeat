/**
 * HushBeat - PPG Digital Filter & Signal Quality Index (SQI)
 *
 * Pure TypeScript module with ZERO React Native UI imports.
 * Engineering rules:
 * - 0.5–4.0 Hz bandpass filter (30–240 bpm) to strip tremor and baseline drift.
 * - SQI gate detecting clipping, finger liftoff, and sudden motion spikes.
 */

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface SQIResult {
  sqi: number; // 0 to 100
  isAcceptable: boolean; // sqi >= 60
  isClipped: boolean;
  isMotionDistorted: boolean;
  meanBrightness: number;
  snrDb: number;
  reasons: string[];
}

/**
 * Calculates 2nd-order Butterworth low-pass biquad coefficients.
 */
export function calculateLowpassCoefficients(fc: number, fs: number): BiquadCoefficients {
  const safeFc = Math.min(Math.max(fc, 0.1), fs * 0.45);
  const omega = (2 * Math.PI * safeFc) / fs;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const alpha = sinOmega / Math.SQRT2; // Q = 1/sqrt(2)

  const b0 = (1 - cosOmega) / 2;
  const b1 = 1 - cosOmega;
  const b2 = (1 - cosOmega) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosOmega;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Calculates 2nd-order Butterworth high-pass biquad coefficients.
 */
export function calculateHighpassCoefficients(fc: number, fs: number): BiquadCoefficients {
  const safeFc = Math.min(Math.max(fc, 0.05), fs * 0.45);
  const omega = (2 * Math.PI * safeFc) / fs;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const alpha = sinOmega / Math.SQRT2; // Q = 1/sqrt(2)

  const b0 = (1 + cosOmega) / 2;
  const b1 = -(1 + cosOmega);
  const b2 = (1 + cosOmega) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosOmega;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * State container for a transposed Direct Form II biquad section.
 */
export class BiquadSection {
  private z1 = 0;
  private z2 = 0;

  constructor(private coeffs: BiquadCoefficients) {}

  public setCoefficients(coeffs: BiquadCoefficients): void {
    this.coeffs = coeffs;
    this.reset();
  }

  public reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  public process(x: number): number {
    const y = this.coeffs.b0 * x + this.z1;
    this.z1 = this.coeffs.b1 * x - this.coeffs.a1 * y + this.z2;
    this.z2 = this.coeffs.b2 * x - this.coeffs.a2 * y;
    return y;
  }
}

/**
 * Real-time streaming 0.5–4.0 Hz bandpass filter for incoming PPG samples.
 * Cascades 2nd-order Highpass (0.5 Hz) and 2nd-order Lowpass (4.0 Hz).
 */
export class PPGBandpassFilter {
  private hpSection: BiquadSection;
  private lpSection: BiquadSection;

  constructor(
    private fs: number = 30,
    private lowCutoff: number = 0.5,
    private highCutoff: number = 4.0
  ) {
    this.hpSection = new BiquadSection(calculateHighpassCoefficients(this.lowCutoff, this.fs));
    this.lpSection = new BiquadSection(calculateLowpassCoefficients(this.highCutoff, this.fs));
  }

  public reset(): void {
    this.hpSection.reset();
    this.lpSection.reset();
  }

  public setSamplingRate(fs: number): void {
    this.fs = fs;
    this.hpSection.setCoefficients(calculateHighpassCoefficients(this.lowCutoff, this.fs));
    this.lpSection.setCoefficients(calculateLowpassCoefficients(this.highCutoff, this.fs));
  }

  public process(rawSample: number): number {
    const hpOut = this.hpSection.process(rawSample);
    return this.lpSection.process(hpOut);
  }
}

/**
 * Applies a 0.5–4.0 Hz digital bandpass filter to an array of samples.
 *
 * @param samples Array of raw brightness values.
 * @param fs Sampling rate in Hz (default 30).
 * @param zeroPhase If true, runs forward and backward passes (zero-phase, eliminating delay).
 */
export function applyBandpassFilter(
  samples: number[],
  fs: number = 30,
  zeroPhase: boolean = true
): number[] {
  if (!samples || samples.length === 0) return [];
  if (samples.length < 5) return [...samples];

  // Remove DC mean to prevent filter startup transient
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const zeroMean = samples.map((s) => s - mean);

  const hp = calculateHighpassCoefficients(0.5, fs);
  const lp = calculateLowpassCoefficients(4.0, fs);

  const forward = (input: number[]): number[] => {
    const hpFilter = new BiquadSection(hp);
    const lpFilter = new BiquadSection(lp);
    const output = new Array<number>(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = lpFilter.process(hpFilter.process(input[i]));
    }
    return output;
  };

  const fwdResult = forward(zeroMean);
  if (!zeroPhase) return fwdResult;

  // Backward pass for zero-phase distortion
  const reversed = fwdResult.slice().reverse();
  const bwdResult = forward(reversed);
  return bwdResult.reverse();
}

/**
 * Checks Signal Quality Index (SQI) for raw red-channel camera frames.
 * Detects:
 * - Clipping / overexposure (all ~255) or darkness / underexposure (< 25)
 * - Motion spikes (excessive first-order derivative jumps)
 * - Signal-to-noise ratio in the pulsatile cardiac band (0.5–4.0 Hz)
 *
 * @param rawRedSamples Raw mean red channel values (0–255).
 * @param fs Sampling rate in Hz (default 30).
 * @returns SQIResult with quality score 0–100%.
 */
export function checkSignalQuality(
  rawRedSamples: number[],
  fs: number = 30
): SQIResult {
  const reasons: string[] = [];
  if (!rawRedSamples || rawRedSamples.length === 0) {
    return {
      sqi: 0,
      isAcceptable: false,
      isClipped: true,
      isMotionDistorted: false,
      meanBrightness: 0,
      snrDb: -99,
      reasons: ['No samples provided'],
    };
  }

  const n = rawRedSamples.length;
  let sum = 0;
  let clipCount = 0;
  let maxDelta = 0;
  let sumSquaredDelta = 0;

  for (let i = 0; i < n; i++) {
    const val = rawRedSamples[i];
    sum += val;

    // Saturation check (overexposure or complete darkness)
    if (val >= 252 || val <= 15) {
      clipCount++;
    }

    if (i > 0) {
      const delta = Math.abs(val - rawRedSamples[i - 1]);
      if (delta > maxDelta) maxDelta = delta;
      sumSquaredDelta += delta * delta;
    }
  }

  const mean = sum / n;
  const clipFraction = clipCount / n;

  // Variance & Standard Deviation
  let sumVar = 0;
  for (let i = 0; i < n; i++) {
    const diff = rawRedSamples[i] - mean;
    sumVar += diff * diff;
  }
  const variance = sumVar / n;
  const stdDev = Math.sqrt(variance);

  let isClipped = false;
  let isMotionDistorted = false;
  let score = 100;

  // 1. Mean brightness check (ideal fingertip + torch is 80-230)
  if (mean < 35) {
    isClipped = true;
    score -= 60;
    reasons.push('Signal too dark; ensure finger firmly covers lens and torch is ON');
  } else if (mean > 248) {
    isClipped = true;
    score -= 60;
    reasons.push('Sensor saturated / overexposed; reduce finger pressure');
  } else if (mean < 60 || mean > 240) {
    score -= 20;
    reasons.push('Brightness near limits');
  }

  // 2. Clipping fraction
  if (clipFraction > 0.08) {
    isClipped = true;
    score -= Math.min(50, Math.round(clipFraction * 100));
    reasons.push(`Clipping detected (${Math.round(clipFraction * 100)}% of samples)`);
  }

  // 3. Flatline / lack of dynamic range check
  if (stdDev < 0.15 && !isClipped) {
    score -= 50;
    reasons.push('Signal flatline; no pulsatile blood flow detected');
  }

  // 4. Motion spike check (sudden jumps between frames)
  // For 30fps video, physiological pulse amplitude changes are smooth (<= 8 per frame)
  if (maxDelta > 20) {
    isMotionDistorted = true;
    score -= 35;
    reasons.push(`Excessive motion artifact (spike: ${maxDelta.toFixed(1)})`);
  } else if (maxDelta > 10) {
    score -= 15;
    reasons.push('Minor motion jitter detected');
  }

  // 5. Filtered signal quality & SNR estimate
  const filtered = applyBandpassFilter(rawRedSamples, fs, true);
  let pulsatileEnergy = 0;
  for (let i = 0; i < filtered.length; i++) {
    pulsatileEnergy += filtered[i] * filtered[i];
  }
  const rmsPulsatile = Math.sqrt(pulsatileEnergy / filtered.length);

  // Noise estimate: high-frequency residual
  const noiseEnergy = sumSquaredDelta / Math.max(1, n - 1);
  const snrEstimate = rmsPulsatile / Math.max(0.01, Math.sqrt(noiseEnergy));
  const snrDb = Math.round(20 * Math.log10(Math.max(0.001, snrEstimate)) * 10) / 10;

  if (snrDb < -5) {
    score -= 20;
    reasons.push('Low signal-to-noise ratio');
  }

  const finalSqi = Math.max(0, Math.min(100, Math.round(score)));
  const isAcceptable = finalSqi >= 60 && !isClipped && !isMotionDistorted;

  return {
    sqi: finalSqi,
    isAcceptable,
    isClipped,
    isMotionDistorted,
    meanBrightness: Math.round(mean * 10) / 10,
    snrDb,
    reasons,
  };
}
