/**
 * HushBeat - Heart Rate Recovery (HRR) Timer Screen
 *
 * Measures post-exercise autonomic heart rate recovery at 1-min and 2-min marks.
 * Supports quick 10s camera PPG captures or direct manual entry from Zeblaze Btalk 4 Pro.
 * Provides vibration alerts at 60s and 120s marks, calculates vagal rebound rating,
 * and saves records to hrr_sessions in local SQLite.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import {
  Camera,
  CameraRef,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { insertHrrSession } from '../db/database';
import { processPpgForHrv } from '../utils/hrvMath';
import { PPGBandpassFilter } from '../utils/ppgFilter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ExerciseType = 'Running' | 'Cycling' | 'HIIT' | 'Strength' | 'Walking' | 'Other';
type CaptureTarget = 'peak' | '1min' | '2min';

export const RecoveryTimerScreen: React.FC = () => {
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Exercise and HR Values
  const [exerciseType, setExerciseType] = useState<ExerciseType>('Running');
  const [peakBpm, setPeakBpm] = useState<number | null>(null);
  const [bpm1min, setBpm1min] = useState<number | null>(null);
  const [bpm2min, setBpm2min] = useState<number | null>(null);

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [sessionSaved, setSessionSaved] = useState(false);

  // Quick 10s Camera Scan state
  const [isCameraScanning, setIsCameraScanning] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<CaptureTarget | null>(null);
  const [cameraCountdown, setCameraCountdown] = useState(10);
  const cameraSamplesRef = useRef<number[]>([]);
  const filterRef = useRef(new PPGBandpassFilter(30, 0.5, 4.0));

  // Manual input text buffer
  const [manualInputVal, setManualInputVal] = useState('');
  const [manualInputTarget, setManualInputTarget] = useState<CaptureTarget | null>(null);

  // 120s Timer Loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (timerRunning && secondsElapsed < 120) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          const next = prev + 1;

          // 1:00 (60s) vibration alert (double buzz)
          if (next === 60) {
            Vibration.vibrate([0, 500, 200, 500]);
          }

          // 2:00 (120s) vibration alert (long double buzz)
          if (next === 120) {
            Vibration.vibrate([0, 800, 300, 800]);
            setTimerRunning(false);
          }

          return next;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerRunning, secondsElapsed]);

  // 10s Camera Scan Countdown
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isCameraScanning && cameraCountdown > 0) {
      interval = setInterval(() => {
        setCameraCountdown((prev) => {
          if (prev <= 1) {
            finishCameraScan();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCameraScanning, cameraCountdown]);

  // Worklet frame capture for quick 10s HR measurement
  const handlePpgSample = useCallback(
    (redValue: number) => {
      if (!isCameraScanning) return;
      filterRef.current.process(redValue);
      cameraSamplesRef.current.push(redValue);
    },
    [isCameraScanning]
  );

  const onPpgWorkletSample = useRunOnJS(handlePpgSample, [handlePpgSample]);

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: { width: 128, height: 128 },
    onFrame(frame) {
      'worklet';
      if (!frame.hasPixelBuffer) {
        frame.dispose();
        return;
      }
      try {
        const buffer = frame.getPixelBuffer();
        const uint8 = new Uint8Array(buffer);
        const centerIdx = Math.floor(uint8.length / 2);
        const redVal = uint8[centerIdx] || 0;
        onPpgWorkletSample(redVal);
      } catch {
        // ignore
      } finally {
        frame.dispose();
      }
    },
  });

  const startCameraScan = (target: CaptureTarget) => {
    if (!hasPermission) {
      requestPermission();
      return;
    }
    cameraSamplesRef.current = [];
    filterRef.current.reset();
    setCameraTarget(target);
    setCameraCountdown(10);
    setIsCameraScanning(true);
  };

  const finishCameraScan = () => {
    setIsCameraScanning(false);
    const samples = cameraSamplesRef.current;
    if (samples.length >= 100) {
      const result = processPpgForHrv(samples, undefined, 30);
      const measuredBpm = Math.round(result.avgBpm);
      if (measuredBpm >= 40 && measuredBpm <= 220) {
        assignBpm(cameraTarget, measuredBpm);
        return;
      }
    }
    Alert.alert(
      'Scan Incomplete',
      'Could not detect steady pulse. Please try scanning again or enter manually.'
    );
  };

  const assignBpm = (target: CaptureTarget | null, bpm: number) => {
    if (target === 'peak') setPeakBpm(bpm);
    if (target === '1min') setBpm1min(bpm);
    if (target === '2min') setBpm2min(bpm);
  };

  const handleManualSubmit = () => {
    const parsed = parseInt(manualInputVal, 10);
    if (!isNaN(parsed) && parsed >= 40 && parsed <= 230) {
      assignBpm(manualInputTarget, parsed);
      setManualInputTarget(null);
      setManualInputVal('');
    } else {
      Alert.alert('Invalid Heart Rate', 'Please enter a valid BPM between 40 and 230.');
    }
  };

  const handleStartTimer = () => {
    if (!peakBpm) {
      Alert.alert('Peak BPM Required', 'Please record your peak heart rate before starting the recovery timer.');
      return;
    }
    setSecondsElapsed(0);
    setTimerRunning(true);
    setSessionSaved(false);
  };

  const handleSaveSession = async () => {
    if (!peakBpm || !bpm1min) {
      Alert.alert('Incomplete Session', 'Please record at least Peak HR and 1-minute HR.');
      return;
    }

    const hr2 = bpm2min ?? bpm1min;
    const drop1 = peakBpm - bpm1min;
    const drop2 = peakBpm - hr2;

    try {
      await insertHrrSession({
        timestamp: new Date().toISOString(),
        exerciseType,
        peakHr: peakBpm,
        hrAt1min: bpm1min,
        hrAt2min: hr2,
        hrr1min: drop1,
        hrr2min: drop2,
        recoveryScore: drop1,
      });
      setSessionSaved(true);
      Alert.alert('Session Saved', 'Heart rate recovery session saved to local database.');
    } catch {
      Alert.alert('Error', 'Failed to save recovery session.');
    }
  };

  const handleReset = () => {
    setPeakBpm(null);
    setBpm1min(null);
    setBpm2min(null);
    setSecondsElapsed(0);
    setTimerRunning(false);
    setSessionSaved(false);
  };

  // Vagal Rebound Assessment
  const drop1 = peakBpm && bpm1min ? peakBpm - bpm1min : null;
  const drop2 = peakBpm && bpm2min ? peakBpm - bpm2min : null;

  let reboundRating = '';
  let reboundColor = '#8E8E93';
  let reboundExplanation = '';

  if (drop1 !== null) {
    if (drop1 >= 18) {
      reboundRating = 'Strong Vagal Rebound';
      reboundColor = '#30D158';
      reboundExplanation =
        'Excellent parasympathetic reactivation. Heart rate dropped rapidly, indicating high aerobic conditioning and low autonomic fatigue.';
    } else if (drop1 >= 12) {
      reboundRating = 'Healthy Recovery';
      reboundColor = '#0A84FF';
      reboundExplanation =
        'Normal autonomic response. Heart rate recovered at a standard clinical pace.';
    } else {
      reboundRating = 'Fatigued / Delayed Recovery';
      reboundColor = '#FF9F0A';
      reboundExplanation =
        'Delayed parasympathetic response. Prolonged sympathetic dominance indicates residual fatigue, dehydration, or strenuous exertion.';
    }
  }

  const progressPercent = Math.min(100, Math.round((secondsElapsed / 120) * 100));

  return (
    <ScrollView contentContainerStyle={styles.container} bounces={false}>
      {/* Hidden camera preview for 10s quick scan */}
      {isCameraScanning && device && hasPermission && (
        <View style={styles.hiddenCamera}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isCameraScanning}
            outputs={[frameOutput]}
            torchMode="on"
          />
        </View>
      )}

      {/* Screen Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Heart Rate Recovery</Text>
        <Text style={styles.subtitle}>
          Track how quickly your heart rate drops at 1 min and 2 min post-workout to assess vagal reactivation.
        </Text>
      </View>

      {/* Exercise Selector */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>EXERCISE TYPE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(['Running', 'Cycling', 'HIIT', 'Strength', 'Walking', 'Other'] as ExerciseType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.chip, exerciseType === type && styles.chipActive]}
              onPress={() => setExerciseType(type)}
            >
              <Text style={[styles.chipText, exerciseType === type && styles.chipTextActive]}>
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 2-Minute Timer Display */}
      <View style={styles.timerCard}>
        <Text style={styles.timerCardHeader}>2-MINUTE RECOVERY TIMER</Text>
        <Text style={styles.timerDisplay}>
          {Math.floor(secondsElapsed / 60)}:
          {secondsElapsed % 60 < 10 ? '0' : ''}
          {secondsElapsed % 60}
          <Text style={styles.timerMax}> / 2:00</Text>
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>

        <View style={styles.markerRow}>
          <Text style={[styles.markerText, secondsElapsed >= 60 && styles.markerTextReached]}>
            ● 1:00 Mark (HRR₁)
          </Text>
          <Text style={[styles.markerText, secondsElapsed >= 120 && styles.markerTextReached]}>
            ● 2:00 Mark (HRR₂)
          </Text>
        </View>

        {!timerRunning && secondsElapsed === 0 && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleStartTimer}>
            <Text style={styles.primaryButtonText}>Start 2-Minute Timer</Text>
          </TouchableOpacity>
        )}

        {timerRunning && (
          <TouchableOpacity style={styles.stopButton} onPress={() => setTimerRunning(false)}>
            <Text style={styles.stopButtonText}>Pause Timer</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* HR Capture Stages (Peak, 1-Min, 2-Min) */}
      <View style={styles.stageGrid}>
        {/* Peak HR */}
        <View style={styles.stageBox}>
          <Text style={styles.stageLabel}>PEAK HR (AT STOP)</Text>
          <Text style={styles.stageValue}>{peakBpm ? `${peakBpm} BPM` : '--'}</Text>
          <View style={styles.stageActionRow}>
            <TouchableOpacity style={styles.miniBtn} onPress={() => startCameraScan('peak')}>
              <Text style={styles.miniBtnText}>📷 Scan (10s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.miniBtnOutline}
              onPress={() => setManualInputTarget('peak')}
            >
              <Text style={styles.miniBtnOutlineText}>✏️ Watch Input</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1-Min HR */}
        <View style={[styles.stageBox, secondsElapsed >= 60 && styles.stageBoxActive]}>
          <Text style={styles.stageLabel}>1-MIN HR (60s MARK)</Text>
          <Text style={styles.stageValue}>{bpm1min ? `${bpm1min} BPM` : '--'}</Text>
          {drop1 !== null && <Text style={styles.dropText}>Drop: -{drop1} BPM</Text>}
          <View style={styles.stageActionRow}>
            <TouchableOpacity style={styles.miniBtn} onPress={() => startCameraScan('1min')}>
              <Text style={styles.miniBtnText}>📷 Scan (10s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.miniBtnOutline}
              onPress={() => setManualInputTarget('1min')}
            >
              <Text style={styles.miniBtnOutlineText}>✏️ Watch Input</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2-Min HR */}
        <View style={[styles.stageBox, secondsElapsed >= 120 && styles.stageBoxActive]}>
          <Text style={styles.stageLabel}>2-MIN HR (120s MARK)</Text>
          <Text style={styles.stageValue}>{bpm2min ? `${bpm2min} BPM` : '--'}</Text>
          {drop2 !== null && <Text style={styles.dropText}>Drop: -{drop2} BPM</Text>}
          <View style={styles.stageActionRow}>
            <TouchableOpacity style={styles.miniBtn} onPress={() => startCameraScan('2min')}>
              <Text style={styles.miniBtnText}>📷 Scan (10s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.miniBtnOutline}
              onPress={() => setManualInputTarget('2min')}
            >
              <Text style={styles.miniBtnOutlineText}>✏️ Watch Input</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Camera Scanning Dialog / Modal Overlay */}
      {isCameraScanning && (
        <View style={styles.modalBanner}>
          <Text style={styles.modalTitle}>
            📷 Scanning {cameraTarget?.toUpperCase()} Heart Rate
          </Text>
          <Text style={styles.modalCountdown}>{cameraCountdown}s remaining</Text>
          <Text style={styles.modalSub}>
            Keep your index finger resting gently over the rear camera lens & flash.
          </Text>
        </View>
      )}

      {/* Manual Input Dialog */}
      {manualInputTarget && (
        <View style={styles.modalBanner}>
          <Text style={styles.modalTitle}>
            Enter {manualInputTarget.toUpperCase()} BPM from Zeblaze Watch
          </Text>
          <TextInput
            style={styles.inputField}
            placeholder="e.g. 154"
            placeholderTextColor="#8E8E93"
            keyboardType="number-pad"
            value={manualInputVal}
            onChangeText={setManualInputVal}
            maxLength={3}
            autoFocus
          />
          <View style={styles.inputButtonsRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleManualSubmit}>
              <Text style={styles.primaryButtonText}>Confirm BPM</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setManualInputTarget(null);
                setManualInputVal('');
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Vagal Rebound Assessment Card */}
      {drop1 !== null && (
        <View style={styles.assessmentCard}>
          <Text style={styles.assessmentHeading}>AUTONOMIC REBOUND RATING</Text>
          <Text style={[styles.assessmentTitle, { color: reboundColor }]}>
            {reboundRating} (-{drop1} BPM in 1 min)
          </Text>
          <Text style={styles.assessmentBody}>{reboundExplanation}</Text>

          {!sessionSaved ? (
            <TouchableOpacity style={styles.saveButton} onPress={handleSaveSession}>
              <Text style={styles.saveButtonText}>Save Session to History</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
              <Text style={styles.resetButtonText}>Start New Session</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0C',
    padding: 16,
    minHeight: '100%',
    paddingBottom: 40,
  },
  hiddenCamera: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipRow: {
    gap: 8,
  },
  chip: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  chipActive: {
    backgroundColor: '#0A84FF',
    borderColor: '#0A84FF',
  },
  chipText: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  timerCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242426',
    marginBottom: 16,
  },
  timerCardHeader: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timerDisplay: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    marginVertical: 4,
  },
  timerMax: {
    fontSize: 18,
    color: '#8E8E93',
    fontWeight: '500',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#2C2C2E',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#30D158',
    borderRadius: 3,
  },
  markerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  markerText: {
    color: '#8E8E93',
    fontSize: 12,
  },
  markerTextReached: {
    color: '#30D158',
    fontWeight: '700',
  },
  stageGrid: {
    gap: 12,
    marginBottom: 16,
  },
  stageBox: {
    backgroundColor: '#161618',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#242426',
  },
  stageBoxActive: {
    borderColor: '#30D158',
  },
  stageLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  stageValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    marginVertical: 4,
  },
  dropText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  stageActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  miniBtn: {
    backgroundColor: '#0A84FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  miniBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  miniBtnOutline: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  miniBtnOutlineText: {
    color: '#EBEBF5',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#0A84FF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  stopButtonText: {
    color: '#FF453A',
    fontSize: 15,
    fontWeight: '700',
  },
  modalBanner: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#0A84FF',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  modalCountdown: {
    color: '#0A84FF',
    fontSize: 24,
    fontWeight: '900',
    marginVertical: 6,
  },
  modalSub: {
    color: '#8E8E93',
    fontSize: 12,
  },
  inputField: {
    backgroundColor: '#0F0F11',
    borderWidth: 1,
    borderColor: '#2C2C2E',
    borderRadius: 10,
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 12,
  },
  inputButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: {
    color: '#8E8E93',
    fontSize: 14,
    fontWeight: '600',
  },
  assessmentCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242426',
    marginTop: 8,
  },
  assessmentHeading: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  assessmentTitle: {
    fontSize: 20,
    fontWeight: '900',
    marginVertical: 6,
  },
  assessmentBody: {
    color: '#EBEBF5',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#30D158',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  resetButton: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
