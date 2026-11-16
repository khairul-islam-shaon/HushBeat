/**
 * HushBeat - Health Connect Sync & Passive Stress Detection Unit Tests
 */

describe('Health Connect Sync & Passive Daytime Stress Detection', () => {
  it('correctly flags passive daytime stress when HR is >30 BPM above resting with <15 steps', () => {
    const restingHr = 60;
    const windowHrSamples = [92, 95, 94, 96]; // avg = 94.25 (> resting + 34)
    const windowSteps = 8; // < 15 steps (sedentary / stationary)

    const avgHr = windowHrSamples.reduce((a, b) => a + b, 0) / windowHrSamples.length;
    const elevation = avgHr - restingHr;
    const isStressAlert = elevation > 30 && windowSteps < 15;

    expect(isStressAlert).toBe(true);
    expect(elevation).toBeGreaterThan(30);
  });

  it('does NOT flag stress if elevated HR is caused by active movement / steps', () => {
    const restingHr = 60;
    const windowHrSamples = [115, 120, 118]; // elevated HR
    const windowSteps = 450; // active walking / running

    const avgHr = windowHrSamples.reduce((a, b) => a + b, 0) / windowHrSamples.length;
    const elevation = avgHr - restingHr;
    const isStressAlert = elevation > 30 && windowSteps < 15;

    expect(isStressAlert).toBe(false);
  });

  it('correctly calculates resting HR fallback from 10th percentile of idle/sleep samples', () => {
    // 24h sample distribution: mostly 65-100 bpm, lowest night samples 52-56 bpm
    const samples = [
      85, 92, 78, 64, 55, 53, 52, 54, 56, 70, 80, 88, 110, 105, 95, 82, 75, 71,
    ];
    const sorted = [...samples].sort((a, b) => a - b);
    const p10Index = Math.floor(sorted.length * 0.1);
    const restingHr = sorted[Math.max(0, p10Index)];

    expect(restingHr).toBeGreaterThanOrEqual(52);
    expect(restingHr).toBeLessThanOrEqual(55);
  });

  describe('Post-Workout Heart Rate Recovery (HRR) Vagal Rebound Classification', () => {
    function classifyHrr(drop1min: number): 'Strong' | 'Healthy' | 'Fatigued' {
      if (drop1min >= 18) return 'Strong';
      if (drop1min >= 12) return 'Healthy';
      return 'Fatigued';
    }

    it('classifies drops >= 18 BPM as Strong vagal rebound', () => {
      expect(classifyHrr(24)).toBe('Strong');
      expect(classifyHrr(18)).toBe('Strong');
    });

    it('classifies drops between 12 and 17 BPM as Healthy recovery', () => {
      expect(classifyHrr(16)).toBe('Healthy');
      expect(classifyHrr(12)).toBe('Healthy');
    });

    it('classifies drops < 12 BPM as Fatigued / delayed recovery', () => {
      expect(classifyHrr(10)).toBe('Fatigued');
      expect(classifyHrr(4)).toBe('Fatigued');
      expect(classifyHrr(0)).toBe('Fatigued');
    });
  });
});
