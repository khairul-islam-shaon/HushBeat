/**
 * HushBeat - Habit Correlation & Dashboard Data Processing Tests
 */

describe('Habit Correlation & Dashboard Metrics Logic', () => {
  it('correctly calculates delta and impact percentage from baseline', () => {
    const baselineSdnn = 50.0;
    const avgNextMorningSdnn = 42.0;

    const delta = Math.round((avgNextMorningSdnn - baselineSdnn) * 10) / 10;
    const impactPercent = Math.round((delta / baselineSdnn) * 100);

    expect(delta).toBe(-8.0);
    expect(impactPercent).toBe(-16);
  });

  it('correctly identifies positive correlation vs negative correlation', () => {
    const baselineSdnn = 45.0;

    // Bad habit (Late meal)
    const lateMealNext = 36.0;
    const lateMealDelta = lateMealNext - baselineSdnn;
    expect(lateMealDelta).toBeLessThan(0);

    // Good habit (Rest / Coherent Breathing)
    const breathingNext = 54.0;
    const breathingDelta = breathingNext - baselineSdnn;
    expect(breathingDelta).toBeGreaterThan(0);
  });

  it('correctly categorizes autonomic readiness scores', () => {
    function categorizeReadiness(score: number): 'Optimal' | 'Balanced' | 'Recover' {
      if (score >= 80) return 'Optimal';
      if (score >= 60) return 'Balanced';
      return 'Recover';
    }

    expect(categorizeReadiness(92)).toBe('Optimal');
    expect(categorizeReadiness(80)).toBe('Optimal');
    expect(categorizeReadiness(79)).toBe('Balanced');
    expect(categorizeReadiness(65)).toBe('Balanced');
    expect(categorizeReadiness(60)).toBe('Balanced');
    expect(categorizeReadiness(59)).toBe('Recover');
    expect(categorizeReadiness(35)).toBe('Recover');
  });

  it('formats sleep duration in minutes to human readable hours and minutes', () => {
    function formatSleep(mins?: number | null) {
      if (!mins || mins <= 0) return '—';
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    }

    expect(formatSleep(465)).toBe('7h 45m');
    expect(formatSleep(60)).toBe('1h 0m');
    expect(formatSleep(0)).toBe('—');
    expect(formatSleep(null)).toBe('—');
  });

  it('handles 14-day trend timeline padding and missing days correctly', () => {
    const mockDbDays = new Map<string, number>([
      ['2026-11-15', 52.4],
      ['2026-11-17', 48.1],
    ]);

    const anchorDate = '2026-11-17';
    const anchorD = new Date(anchorDate + 'T12:00:00Z');
    const timeline: { date: string; avgSdnn: number | null }[] = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(anchorD);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      timeline.push({
        date: dateStr,
        avgSdnn: mockDbDays.get(dateStr) ?? null,
      });
    }

    expect(timeline).toHaveLength(14);
    expect(timeline[13].date).toBe('2026-11-17');
    expect(timeline[13].avgSdnn).toBe(48.1);
    expect(timeline[11].date).toBe('2026-11-15');
    expect(timeline[11].avgSdnn).toBe(52.4);
    expect(timeline[12].avgSdnn).toBeNull(); // 2026-11-16 was missing
  });
});
