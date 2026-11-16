/**
 * HushBeat - Main Health Dashboard Screen
 *
 * Displays:
 * 1. Automatic & manual Google Health Connect sync with Zeblaze Btalk 4 Pro
 * 2. Today's Autonomic Readiness Score (0-100) with color-coded qualitative status
 * 3. Latest Camera PPG metrics (SDNN, RMSSD, Stress Score)
 * 4. Zeblaze Watch metrics (Resting HR, Sleep Duration, Steps)
 * 5. 14-day SDNN Trend Chart overlaid against 14-day rolling baseline
 * 6. Passive daytime stress spike alerts (>30 BPM above resting while stationary)
 * 7. One-tap daily habit tags with next-morning SDNN correlation insights
 * 8. Quick biometric action launchers
 *
 * 100% offline, local-first storage via expo-sqlite. Zero cloud.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DailySdnnTrendPoint,
  HabitCorrelationInsight,
  HabitLog,
  deleteHabitLogByDateAndType,
  get14DayDailySdnnTrends,
  getHabitLogsByDate,
  getHabitSdnnCorrelations,
  initDatabase,
  insertHabitLog,
} from '../db/database';
import {
  DaytimeStressAlert,
  syncHealthConnectWatchMetrics,
} from '../services/healthConnectSync';
import { ScanType, useHealthStore } from '../store/useHealthStore';

const SCREEN_WIDTH = Dimensions.get('window').width;

const HABIT_TAGS = [
  { id: 'caffeine', label: 'Caffeine', emoji: '☕' },
  { id: 'late_meal', label: 'Late Meal', emoji: '🍕' },
  { id: 'poor_sleep', label: 'Poor Sleep', emoji: '🥱' },
  { id: 'heavy_workout', label: 'Heavy Workout', emoji: '🏋️' },
  { id: 'high_stress', label: 'High Stress', emoji: '⚡' },
];

interface DashboardScreenProps {
  onNavigateToTab: (tab: 'scanner' | 'breathing' | 'recovery', scanType?: ScanType) => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigateToTab }) => {
  const {
    latestScan,
    baseline,
    todayWatchMetrics,
    loadInitialData,
  } = useHealthStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(null);
  const [trends, setTrends] = useState<DailySdnnTrendPoint[]>([]);
  const [todayHabits, setTodayHabits] = useState<HabitLog[]>([]);
  const [correlations, setCorrelations] = useState<HabitCorrelationInsight[]>([]);
  const [stressAlerts, setStressAlerts] = useState<DaytimeStressAlert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const todayDateStr = new Date().toISOString().slice(0, 10);

  // Load dashboard data from SQLite
  const loadDashboardData = useCallback(async () => {
    try {
      await loadInitialData();

      const [trendData, habitData, correlationData] = await Promise.all([
        get14DayDailySdnnTrends(todayDateStr),
        getHabitLogsByDate(todayDateStr),
        getHabitSdnnCorrelations(baseline?.avgSdnnMs),
      ]);

      setTrends(trendData);
      setTodayHabits(habitData);
      setCorrelations(correlationData);
    } catch (err) {
      console.warn('Error loading dashboard data:', err);
    }
  }, [todayDateStr, baseline?.avgSdnnMs, loadInitialData]);

  // Initial startup: init DB, load local state, and trigger automatic watch sync
  useEffect(() => {
    let mounted = true;

    async function startup() {
      await initDatabase();
      if (!mounted) return;
      await loadDashboardData();

      // Automatic silent watch sync on launch
      try {
        setIsSyncing(true);
        const res = await syncHealthConnectWatchMetrics(14);
        if (mounted && res.success) {
          setLastSyncedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          setStressAlerts(res.stressAlerts);
          await loadDashboardData();
        }
      } catch (err) {
        console.log('Auto-sync notice (Health Connect not yet configured or permission pending):', err);
      } finally {
        if (mounted) setIsSyncing(false);
      }
    }

    startup();

    return () => {
      mounted = false;
    };
  }, []);

  // Manual Health Connect Sync
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await syncHealthConnectWatchMetrics(14);
      if (res.success) {
        setLastSyncedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setStressAlerts(res.stressAlerts);
        await loadDashboardData();

        let alertMsg = `Synced ${res.daysSynced} days from Zeblaze Btalk 4 Pro.`;
        if (res.stressAlerts.length > 0) {
          alertMsg += `\n\n⚠️ ${res.stressAlerts.length} daytime stress spike(s) detected.`;
        }
        Alert.alert('Health Connect Sync', alertMsg);
      } else {
        Alert.alert(
          'Sync Incomplete',
          res.errors.length > 0
            ? res.errors.join('\n')
            : 'Could not access Health Connect. Please confirm Zeblaze Connect and Health Connect permissions.'
        );
      }
    } catch (err: any) {
      Alert.alert('Sync Error', err?.message || 'Error communicating with Health Connect.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Pull to refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  // Toggle Daily Habit Tag
  const handleToggleHabit = async (habitId: string) => {
    try {
      const existing = todayHabits.find((h) => h.habitType === habitId);
      if (existing) {
        await deleteHabitLogByDateAndType(todayDateStr, habitId);
      } else {
        await insertHabitLog({
          date: todayDateStr,
          habitType: habitId,
          durationSeconds: 0,
        });
      }
      const updated = await getHabitLogsByDate(todayDateStr);
      setTodayHabits(updated);

      const updatedCorrelations = await getHabitSdnnCorrelations(baseline?.avgSdnnMs);
      setCorrelations(updatedCorrelations);
    } catch (err) {
      console.warn('Failed to toggle habit:', err);
    }
  };

  // Format sleep minutes to "Xh Ym"
  const formatSleep = (mins?: number | null) => {
    if (!mins || mins <= 0) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  // Readiness evaluation
  const readiness = latestScan?.readinessScore ?? 75;
  const getReadinessTheme = (score: number) => {
    if (score >= 80) {
      return {
        label: 'Optimal',
        color: '#30D158',
        desc: 'Parasympathetic tone is elevated. Body is primed for high physical and cognitive strain.',
      };
    }
    if (score >= 60) {
      return {
        label: 'Balanced',
        color: '#0A84FF',
        desc: 'Autonomic nervous system is stable. Normal training capacity and steady baseline recovery.',
      };
    }
    return {
      label: 'Recover',
      color: '#FF9F0A',
      desc: 'Elevated sympathetic tone or fatigue. Prioritize resonance breathing, hydration, and sleep.',
    };
  };

  const readinessTheme = getReadinessTheme(readiness);

  // Compute 14-day chart metrics
  const validTrendValues = trends.map((t) => t.avgSdnn).filter((v): v is number => v !== null && v > 0);
  const maxTrendSdnn = validTrendValues.length > 0 ? Math.max(...validTrendValues, baseline?.avgSdnnMs ?? 60, 60) : 80;
  const chartHeight = 110;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0A84FF" />}
    >
      {/* Top Header & Watch Sync Bar */}
      <View style={styles.syncHeaderCard}>
        <View style={styles.syncHeaderLeft}>
          <Text style={styles.watchModelText}>⌚ Zeblaze Btalk 4 Pro</Text>
          <Text style={styles.syncTimestampText}>
            {lastSyncedTime ? `Last synced at ${lastSyncedTime}` : 'Tap sync to refresh Health Connect'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonActive]}
          onPress={handleManualSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color="#0A84FF" />
          ) : (
            <Text style={styles.syncButtonText}>Sync Watch</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Readiness Score Card */}
      <View style={[styles.readinessCard, { borderColor: `${readinessTheme.color}55` }]}>
        <View style={styles.readinessTopRow}>
          <View>
            <Text style={styles.sectionOverline}>AUTONOMIC READINESS</Text>
            <View style={styles.scoreRow}>
              <Text style={[styles.readinessScoreText, { color: readinessTheme.color }]}>
                {readiness}
              </Text>
              <Text style={styles.scoreMaxText}>/100</Text>
              <View style={[styles.statusBadge, { backgroundColor: `${readinessTheme.color}25` }]}>
                <Text style={[styles.statusBadgeText, { color: readinessTheme.color }]}>
                  {readinessTheme.label}
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.scanShortcutButton}
            onPress={() => onNavigateToTab('scanner', 'morning')}
          >
            <Text style={styles.scanShortcutText}>+ Morning Check</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.readinessDesc}>{readinessTheme.desc}</Text>

        {/* Readiness Meter Bar */}
        <View style={styles.meterTrack}>
          <View
            style={[
              styles.meterFill,
              { width: `${Math.min(100, Math.max(5, readiness))}%`, backgroundColor: readinessTheme.color },
            ]}
          />
        </View>
      </View>

      {/* Biometric Snapshot Grid */}
      <View style={styles.metricGrid}>
        {/* Latest Camera SDNN */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>CAMERA SDNN</Text>
          <View style={styles.metricValueRow}>
            <Text style={styles.metricValue}>{latestScan?.sdnnMs ? Math.round(latestScan.sdnnMs) : '—'}</Text>
            <Text style={styles.metricUnit}>ms</Text>
          </View>
          <Text style={styles.metricSub}>
            {baseline?.avgSdnnMs ? `Baseline: ${baseline.avgSdnnMs} ms` : 'Overall autonomic variability'}
          </Text>
        </View>

        {/* Latest Camera RMSSD */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>CAMERA RMSSD</Text>
          <View style={styles.metricValueRow}>
            <Text style={styles.metricValue}>{latestScan?.rmssdMs ? Math.round(latestScan.rmssdMs) : '—'}</Text>
            <Text style={styles.metricUnit}>ms</Text>
          </View>
          <Text style={styles.metricSub}>Vagal parasympathetic tone</Text>
        </View>

        {/* Zeblaze Resting HR */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WATCH RESTING HR</Text>
          <View style={styles.metricValueRow}>
            <Text style={styles.metricValue}>
              {todayWatchMetrics?.restingHr ? Math.round(todayWatchMetrics.restingHr) : '—'}
            </Text>
            <Text style={styles.metricUnit}>BPM</Text>
          </View>
          <Text style={styles.metricSub}>
            {baseline?.avgRestingHr ? `14d Avg: ${baseline.avgRestingHr} BPM` : 'Zeblaze Health Connect'}
          </Text>
        </View>

        {/* Zeblaze Sleep Duration */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WATCH SLEEP</Text>
          <View style={styles.metricValueRow}>
            <Text style={styles.metricValue}>
              {formatSleep(todayWatchMetrics?.sleepDurationMinutes)}
            </Text>
          </View>
          <Text style={styles.metricSub}>
            {todayWatchMetrics?.sleepDeepMinutes
              ? `Deep: ${formatSleep(todayWatchMetrics.sleepDeepMinutes)}`
              : 'Last night sync'}
          </Text>
        </View>
      </View>

      {/* 14-Day SDNN Trend Chart */}
      <View style={styles.chartCard}>
        <View style={styles.chartHeaderRow}>
          <View>
            <Text style={styles.chartTitle}>14-Day HRV SDNN Trend</Text>
            <Text style={styles.chartSubtitle}>Daily morning autonomic variability</Text>
          </View>

          {baseline?.avgSdnnMs ? (
            <View style={styles.baselineTag}>
              <View style={styles.baselineTagLine} />
              <Text style={styles.baselineTagText}>Baseline: {baseline.avgSdnnMs} ms</Text>
            </View>
          ) : null}
        </View>

        {/* Bar Chart Canvas */}
        <View style={[styles.chartContainer, { height: chartHeight }]}>
          {/* Baseline Guideline Overlay */}
          {baseline?.avgSdnnMs && maxTrendSdnn > 0 ? (
            <View
              style={[
                styles.baselineGuideline,
                {
                  bottom: Math.min(
                    chartHeight - 10,
                    Math.max(10, (baseline.avgSdnnMs / maxTrendSdnn) * chartHeight)
                  ),
                },
              ]}
            >
              <Text style={styles.baselineGuidelineText}>{baseline.avgSdnnMs} ms</Text>
            </View>
          ) : null}

          {/* Daily Bars */}
          <View style={styles.barsRow}>
            {trends.map((pt, idx) => {
              const hasVal = pt.avgSdnn !== null && pt.avgSdnn > 0;
              const val = pt.avgSdnn ?? 0;
              const barHeight = hasVal ? Math.max(8, (val / maxTrendSdnn) * (chartHeight - 16)) : 4;
              const isAboveBaseline = baseline?.avgSdnnMs ? val >= baseline.avgSdnnMs : true;
              const barColor = hasVal
                ? isAboveBaseline
                  ? '#30D158'
                  : '#0A84FF'
                : '#2C2C2E';

              const dayLabel = pt.date.slice(8); // 'DD'

              return (
                <View key={pt.date + idx} style={styles.barColumn}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: barHeight,
                          backgroundColor: barColor,
                          opacity: hasVal ? 1 : 0.4,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barDateLabel, idx === 13 && styles.barDateLabelToday]}>
                    {idx === 13 ? 'Today' : dayLabel}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.chartLegendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#30D158' }]} />
            <Text style={styles.legendText}>≥ Baseline</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#0A84FF' }]} />
            <Text style={styles.legendText}>&lt; Baseline</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#48484A' }]} />
            <Text style={styles.legendText}>No Scan</Text>
          </View>
        </View>
      </View>

      {/* Passive Daytime Stress Spike Alerts */}
      {stressAlerts.length > 0 && (
        <View style={styles.stressAlertCard}>
          <View style={styles.alertHeaderRow}>
            <Text style={styles.alertIcon}>⚠️</Text>
            <View style={styles.alertHeaderTextContainer}>
              <Text style={styles.alertTitle}>Passive Daytime Stress Spike</Text>
              <Text style={styles.alertSubtitle}>
                {stressAlerts.length} sedentary elevated heart rate window(s) detected
              </Text>
            </View>
          </View>

          {stressAlerts.slice(0, 3).map((alert, i) => {
            const timeFormatted = `${new Date(alert.startTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })} - ${new Date(alert.endTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}`;

            return (
              <View key={i} style={styles.alertItemRow}>
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>+{Math.round(alert.elevationAboveResting)} BPM</Text>
                </View>
                <View style={styles.alertDetails}>
                  <Text style={styles.alertTime}>{timeFormatted}</Text>
                  <Text style={styles.alertMetrics}>
                    Avg HR: {alert.avgHr} BPM (Resting: {alert.restingHr}) • {alert.steps} steps
                  </Text>
                </View>
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.calmButton}
            onPress={() => onNavigateToTab('breathing')}
          >
            <Text style={styles.calmButtonText}>🧘 Restore Vagal Tone with 3-Min Breathing</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Daily Habit Tags */}
      <View style={styles.habitsCard}>
        <View style={styles.habitsHeaderRow}>
          <Text style={styles.cardTitle}>Today's Lifestyle & Habits</Text>
          <Text style={styles.cardSubtitle}>Tap tags to record habits affecting tonight's HRV</Text>
        </View>

        <View style={styles.tagsContainer}>
          {HABIT_TAGS.map((tag) => {
            const isLogged = todayHabits.some((h) => h.habitType === tag.id);
            return (
              <TouchableOpacity
                key={tag.id}
                style={[styles.tagButton, isLogged && styles.tagButtonActive]}
                onPress={() => handleToggleHabit(tag.id)}
              >
                <Text style={styles.tagEmoji}>{tag.emoji}</Text>
                <Text style={[styles.tagLabel, isLogged && styles.tagLabelActive]}>
                  {tag.label}
                </Text>
                {isLogged && <Text style={styles.tagCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Habit Correlation Insights */}
        <View style={styles.correlationContainer}>
          <Text style={styles.correlationTitle}>AUTONOMIC CORRELATIONS</Text>
          {correlations.length > 0 ? (
            correlations.map((c) => {
              const habit = HABIT_TAGS.find((h) => h.id === c.habitType);
              const isNegative = c.deltaFromBaseline < 0;
              return (
                <View key={c.habitType} style={styles.correlationItem}>
                  <Text style={styles.correlationEmoji}>{habit?.emoji || '•'}</Text>
                  <View style={styles.correlationTextCol}>
                    <Text style={styles.correlationHabitName}>{habit?.label || c.habitType}</Text>
                    <Text style={styles.correlationSampleCount}>
                      Based on {c.count} next-morning scan{c.count > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.deltaBadge,
                      { backgroundColor: isNegative ? 'rgba(255, 69, 58, 0.2)' : 'rgba(48, 209, 88, 0.2)' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.deltaText,
                        { color: isNegative ? '#FF453A' : '#30D158' },
                      ]}
                    >
                      {c.deltaFromBaseline > 0 ? `+${c.deltaFromBaseline}` : c.deltaFromBaseline} ms ({c.impactPercent}%)
                    </Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.noCorrelationText}>
              Log daily habits and record morning scans to uncover personal autonomic correlations (e.g. late meals, caffeine).
            </Text>
          )}
        </View>
      </View>

      {/* Quick Launchers */}
      <View style={styles.quickLaunchRow}>
        <TouchableOpacity
          style={styles.quickLaunchCard}
          onPress={() => onNavigateToTab('scanner', 'spot_check')}
        >
          <Text style={styles.quickIcon}>💓</Text>
          <Text style={styles.quickTitle}>PPG Scan</Text>
          <Text style={styles.quickSub}>Camera HRV</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickLaunchCard}
          onPress={() => onNavigateToTab('breathing')}
        >
          <Text style={styles.quickIcon}>🧘</Text>
          <Text style={styles.quickTitle}>Breathe</Text>
          <Text style={styles.quickSub}>5.5s Pacer</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickLaunchCard}
          onPress={() => onNavigateToTab('recovery')}
        >
          <Text style={styles.quickIcon}>⏱️</Text>
          <Text style={styles.quickTitle}>HRR Timer</Text>
          <Text style={styles.quickSub}>Vagal Rebound</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  syncHeaderCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161618',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#242428',
  },
  syncHeaderLeft: {
    flex: 1,
  },
  watchModelText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  syncTimestampText: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#0A84FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    minWidth: 88,
    alignItems: 'center',
  },
  syncButtonActive: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '700',
  },
  readinessCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  readinessTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sectionOverline: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },
  readinessScoreText: {
    fontSize: 48,
    fontWeight: '900',
  },
  scoreMaxText: {
    color: '#8E8E93',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 12,
    alignSelf: 'center',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scanShortcutButton: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  scanShortcutText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  readinessDesc: {
    color: '#D1D1D6',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  meterTrack: {
    height: 6,
    backgroundColor: '#242428',
    borderRadius: 3,
    marginTop: 14,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  metricCard: {
    width: (SCREEN_WIDTH - 44) / 2,
    backgroundColor: '#161618',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#242428',
    marginBottom: 12,
  },
  metricLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: 4,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  metricUnit: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  metricSub: {
    color: '#636366',
    fontSize: 10,
  },
  chartCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242428',
    marginBottom: 16,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  chartTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  chartSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 2,
  },
  baselineTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  baselineTagLine: {
    width: 10,
    height: 2,
    backgroundColor: '#30D158',
    marginRight: 6,
  },
  baselineTagText: {
    color: '#30D158',
    fontSize: 10,
    fontWeight: '700',
  },
  chartContainer: {
    position: 'relative',
    justifyContent: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: '#242428',
    paddingBottom: 4,
  },
  baselineGuideline: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(48, 209, 88, 0.45)',
    borderStyle: 'dashed',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 1,
  },
  baselineGuidelineText: {
    color: '#30D158',
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#161618',
    paddingHorizontal: 4,
    marginTop: -8,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
    zIndex: 2,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  barTrack: {
    height: '80%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: 10,
    borderRadius: 4,
  },
  barDateLabel: {
    color: '#636366',
    fontSize: 8,
    marginTop: 6,
  },
  barDateLabelToday: {
    color: '#0A84FF',
    fontWeight: '800',
  },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  legendText: {
    color: '#8E8E93',
    fontSize: 10,
  },
  stressAlertCard: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    marginBottom: 16,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  alertHeaderTextContainer: {
    flex: 1,
  },
  alertTitle: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '800',
  },
  alertSubtitle: {
    color: '#D1D1D6',
    fontSize: 11,
    marginTop: 1,
  },
  alertItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161618',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  alertBadge: {
    backgroundColor: 'rgba(255, 69, 58, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 10,
  },
  alertBadgeText: {
    color: '#FF453A',
    fontSize: 11,
    fontWeight: '800',
  },
  alertDetails: {
    flex: 1,
  },
  alertTime: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  alertMetrics: {
    color: '#8E8E93',
    fontSize: 10,
    marginTop: 2,
  },
  calmButton: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#FF453A',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  calmButtonText: {
    color: '#FF453A',
    fontSize: 12,
    fontWeight: '700',
  },
  habitsCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242428',
    marginBottom: 16,
  },
  habitsHeaderRow: {
    marginBottom: 12,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 2,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    margin: 4,
  },
  tagButtonActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderColor: '#0A84FF',
  },
  tagEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  tagLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  tagLabelActive: {
    color: '#0A84FF',
    fontWeight: '700',
  },
  tagCheck: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  correlationContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#242428',
    paddingTop: 12,
  },
  correlationTitle: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  correlationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  correlationEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  correlationTextCol: {
    flex: 1,
  },
  correlationHabitName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  correlationSampleCount: {
    color: '#636366',
    fontSize: 10,
  },
  deltaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deltaText: {
    fontSize: 11,
    fontWeight: '800',
  },
  noCorrelationText: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  quickLaunchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickLaunchCard: {
    flex: 1,
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  quickIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  quickTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  quickSub: {
    color: '#8E8E93',
    fontSize: 10,
    marginTop: 2,
  },
});
