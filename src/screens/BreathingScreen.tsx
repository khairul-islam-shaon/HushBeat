/**
 * HushBeat - Resonance Breathing Pacer Screen (Biofeedback)
 *
 * 5.5s Inhale / 5.5s Exhale resonance breathing circle (coherent frequency ~5.5 bpm).
 * Supports gentle haptic transitions, optional live camera PPG monitoring,
 * Pre- vs Post-Breathing SDNN comparison, and habit logging to SQLite.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Camera,
  CameraRef,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { insertHabitLog } from '../db/database';
import { useHealthStore } from '../store/useHealthStore';
import { PPGBandpassFilter } from '../utils/ppgFilter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_SESSION_SECONDS = 180; // 3 minutes
const INHALE_MS = 5500;
const EXHALE_MS = 5500;

export interface BreathingScreenProps {
  onNavigateToScanner?: (scanType: 'pre_breathing' | 'post_breathing') => void;
}

export const BreathingScreen: React.FC<BreathingScreenProps> = ({
  onNavigateToScanner,
}) => {
  const { preBreathingScan, postBreathingScan } = useHealthStore();

  const [isActive, setIsActive] = useState(false);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(TOTAL_SESSION_SECONDS);
  const [phase, setPhase] = useState<'inhale' | 'exhale'>('inhale');
  const [enableLivePpg, setEnableLivePpg] = useState(false);
  const [livePpgWave, setLivePpgWave] = useState<number[]>([]);
  const [sessionCompleted, setSessionCompleted] = useState(false);

  // Animation scale value (1.0 = base size, 1.7 = expanded)
  const circleScale = useRef(new Animated.Value(1.0)).current;
  const loopRef = useRef<boolean>(false);

  // Optional live camera PPG monitor
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const filterRef = useRef(new PPGBandpassFilter(30, 0.5, 4.0));

  // Trigger gentle haptic pulse
  const triggerHaptic = useCallback(async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics unavailable on emulator or web
    }
  }, []);

  // Breathing pacer animation loop (5.5s Inhale -> 5.5s Exhale)
  const runPacerCycle = useCallback(() => {
    if (!loopRef.current) return;

    // Phase 1: Inhale (5.5s)
    setPhase('inhale');
    triggerHaptic();

    Animated.timing(circleScale, {
      toValue: 1.7,
      duration: INHALE_MS,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !loopRef.current) return;

      // Phase 2: Exhale (5.5s)
      setPhase('exhale');
      triggerHaptic();

      Animated.timing(circleScale, {
        toValue: 1.0,
        duration: EXHALE_MS,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start(({ finished: exhaleFinished }) => {
        if (exhaleFinished && loopRef.current) {
          runPacerCycle();
        }
      });
    });
  }, [circleScale, triggerHaptic]);

  // Session timer countdown (180s)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isActive && sessionSecondsLeft > 0) {
      interval = setInterval(() => {
        setSessionSecondsLeft((prev) => {
          if (prev <= 1) {
            handleCompleteSession();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, sessionSecondsLeft]);

  const handleStartSession = () => {
    setIsActive(true);
    setSessionCompleted(false);
    setSessionSecondsLeft(TOTAL_SESSION_SECONDS);
    loopRef.current = true;
    runPacerCycle();
  };

  const handleStopSession = () => {
    loopRef.current = false;
    circleScale.stopAnimation();
    Animated.timing(circleScale, {
      toValue: 1.0,
      duration: 300,
      useNativeDriver: true,
    }).start();
    setIsActive(false);
  };

  const handleCompleteSession = async () => {
    handleStopSession();
    setSessionCompleted(true);
    await triggerHaptic();

    // Auto-log habit to SQLite
    try {
      await insertHabitLog({
        date: new Date().toISOString().slice(0, 10),
        habitType: 'breathing_biofeedback',
        durationSeconds: TOTAL_SESSION_SECONDS,
        notes: 'Resonance coherent breathing session (5.5 bpm)',
      });
    } catch (e) {
      console.warn('Failed to save breathing habit log:', e);
    }
  };

  // Optional PPG frame stream handling during breathing
  const handlePpgSample = useCallback((redVal: number) => {
    if (!enableLivePpg || !isActive) return;
    const filtered = filterRef.current.process(redVal);
    setLivePpgWave((prev) => {
      const updated = [...prev, filtered];
      return updated.length > 40 ? updated.slice(1) : updated;
    });
  }, [enableLivePpg, isActive]);

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

  const minutesLeft = Math.floor(sessionSecondsLeft / 60);
  const secondsLeft = sessionSecondsLeft % 60;
  const formattedTime = `${minutesLeft}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;

  // SDNN Delta calculation if both pre and post scans are present
  const hasPreAndPost = preBreathingScan && postBreathingScan;
  const sdnnDelta = hasPreAndPost
    ? Math.round((postBreathingScan.sdnnMs - preBreathingScan.sdnnMs) * 10) / 10
    : null;
  const sdnnPercentChange = hasPreAndPost && preBreathingScan.sdnnMs > 0
    ? Math.round(((postBreathingScan.sdnnMs - preBreathingScan.sdnnMs) / preBreathingScan.sdnnMs) * 100)
    : null;

  return (
    <ScrollView contentContainerStyle={styles.container} bounces={false}>
      {/* Background camera when optional live PPG monitor is toggled */}
      {enableLivePpg && hasPermission && device && (
        <View style={styles.hiddenCameraContainer}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            outputs={[frameOutput]}
            torchMode={isActive ? 'on' : 'off'}
          />
        </View>
      )}

      {/* Screen Title */}
      <View style={styles.header}>
        <Text style={styles.title}>Resonance Breathing</Text>
        <Text style={styles.subtitle}>
          Coherent frequency at 5.5 breaths/min to synchronize heart rate variability & vagal nerve tone.
        </Text>
      </View>

      {/* Breathing Animated Pacer Circle */}
      <View style={styles.pacerContainer}>
        <Animated.View
          style={[
            styles.animatedCircle,
            {
              transform: [{ scale: circleScale }],
              backgroundColor: phase === 'inhale' ? '#0A84FF20' : '#30D15820',
              borderColor: phase === 'inhale' ? '#0A84FF' : '#30D158',
            },
          ]}
        >
          <View
            style={[
              styles.innerCoreCircle,
              { backgroundColor: phase === 'inhale' ? '#0A84FF' : '#30D158' },
            ]}
          />
        </Animated.View>

        {/* Phase Instruction & Timer */}
        <View style={styles.pacerTextOverlay}>
          <Text style={styles.phaseLabel}>
            {isActive
              ? phase === 'inhale'
                ? 'IN-HALE'
                : 'EX-HALE'
              : sessionCompleted
              ? 'SESSION DONE'
              : 'READY'}
          </Text>
          <Text style={styles.timerCountdown}>{formattedTime}</Text>
          <Text style={styles.cycleRateText}>5.5s in • 5.5s out</Text>
        </View>
      </View>

      {/* Optional Real-Time PPG Waveform Under Pacer */}
      {enableLivePpg && isActive && (
        <View style={styles.livePpgContainer}>
          <Text style={styles.livePpgLabel}>LIVE RSA PULSE STABILIZATION</Text>
          <View style={styles.waveBarsRow}>
            {livePpgWave.map((val, idx) => {
              const clamped = Math.max(-10, Math.min(10, val));
              const barHeight = Math.max(4, Math.round(((clamped + 10) / 20) * 35));
              return <View key={idx} style={[styles.waveBar, { height: barHeight }]} />;
            })}
          </View>
        </View>
      )}

      {/* Controls: Start/Stop & Camera PPG Toggle */}
      <View style={styles.controlsRow}>
        {!isActive ? (
          <TouchableOpacity style={styles.startButton} onPress={handleStartSession}>
            <Text style={styles.startButtonText}>
              {sessionCompleted ? 'Repeat 3m Session' : 'Start 3-Minute Breathing'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={handleStopSession}>
            <Text style={styles.stopButtonText}>Pause Session</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.togglePpgButton, enableLivePpg && styles.togglePpgButtonActive]}
          onPress={() => setEnableLivePpg(!enableLivePpg)}
        >
          <Text style={styles.togglePpgText}>
            {enableLivePpg ? '📷 Live PPG: ON' : '📷 Live PPG: OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Pre & Post Breathing SDNN Biofeedback Verification */}
      <View style={styles.comparisonCard}>
        <Text style={styles.cardHeader}>BIOFEEDBACK VERIFICATION (SDNN)</Text>
        <Text style={styles.cardDescription}>
          Quantify how coherent breathing expands your parasympathetic autonomic flexibility.
        </Text>

        <View style={styles.scanButtonsRow}>
          <TouchableOpacity
            style={[styles.scanStepButton, preBreathingScan && styles.scanStepButtonDone]}
            onPress={() => onNavigateToScanner?.('pre_breathing')}
          >
            <Text style={styles.scanStepTitle}>1. Pre-Scan (60s)</Text>
            <Text style={styles.scanStepVal}>
              {preBreathingScan ? `${preBreathingScan.sdnnMs} ms` : 'Not run'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.scanStepButton, postBreathingScan && styles.scanStepButtonDone]}
            onPress={() => onNavigateToScanner?.('post_breathing')}
          >
            <Text style={styles.scanStepTitle}>2. Post-Scan (60s)</Text>
            <Text style={styles.scanStepVal}>
              {postBreathingScan ? `${postBreathingScan.sdnnMs} ms` : 'Not run'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Delta Display */}
        {hasPreAndPost && (
          <View style={styles.deltaBox}>
            <Text style={styles.deltaLabel}>AUTONOMIC RECOVERY DELTA</Text>
            <Text
              style={[
                styles.deltaValue,
                sdnnDelta !== null && sdnnDelta >= 0 ? styles.deltaPositive : styles.deltaNegative,
              ]}
            >
              {sdnnDelta !== null && sdnnDelta >= 0 ? `+${sdnnDelta}` : sdnnDelta} ms
              {sdnnPercentChange !== null && ` (${sdnnPercentChange >= 0 ? '+' : ''}${sdnnPercentChange}%)`}
            </Text>
            <Text style={styles.deltaSubtext}>
              {sdnnDelta !== null && sdnnDelta >= 0
                ? 'Excellent vagal response. Your heart rate variability increased significantly.'
                : 'Subtle autonomic shift. Continued resonance practice builds deeper vagal tone.'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0C',
    padding: 20,
    minHeight: '100%',
    paddingBottom: 40,
  },
  hiddenCameraContainer: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
  },
  header: {
    marginBottom: 20,
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
  pacerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 260,
    marginVertical: 12,
  },
  animatedCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  innerCoreCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    opacity: 0.8,
  },
  pacerTextOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseLabel: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  timerCountdown: {
    color: '#EBEBF5',
    fontSize: 32,
    fontWeight: '800',
    marginVertical: 4,
  },
  cycleRateText: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  livePpgContainer: {
    backgroundColor: '#161618',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#242426',
  },
  livePpgLabel: {
    color: '#30D158',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  waveBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    gap: 3,
  },
  waveBar: {
    flex: 1,
    backgroundColor: '#30D158',
    borderRadius: 2,
  },
  controlsRow: {
    gap: 12,
    marginBottom: 24,
  },
  startButton: {
    backgroundColor: '#30D158',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },
  stopButton: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#FF453A',
    fontSize: 15,
    fontWeight: '700',
  },
  togglePpgButton: {
    backgroundColor: '#1C1C1E',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  togglePpgButtonActive: {
    borderColor: '#30D158',
  },
  togglePpgText: {
    color: '#EBEBF5',
    fontSize: 13,
    fontWeight: '600',
  },
  comparisonCard: {
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242426',
  },
  cardHeader: {
    color: '#5AC8FA',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardDescription: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  scanButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  scanStepButton: {
    flex: 1,
    backgroundColor: '#0F0F11',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  scanStepButtonDone: {
    borderColor: '#30D158',
  },
  scanStepTitle: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
  },
  scanStepVal: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  deltaBox: {
    marginTop: 16,
    backgroundColor: '#0F0F11',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  deltaLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deltaValue: {
    fontSize: 26,
    fontWeight: '900',
    marginVertical: 4,
  },
  deltaPositive: {
    color: '#30D158',
  },
  deltaNegative: {
    color: '#FF9F0A',
  },
  deltaSubtext: {
    color: '#EBEBF5',
    fontSize: 12,
    lineHeight: 16,
  },
});
