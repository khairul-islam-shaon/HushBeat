/**
 * HushBeat - Camera PPG Scanner Screen
 *
 * Captures real-time red-channel brightness via rear camera & torch,
 * feeds samples through 0.5–4.0 Hz bandpass filter & SQI gate,
 * visualizes pulse waveform, and computes/persists 60s HRV metrics.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import { ScanType, useHealthStore } from '../store/useHealthStore';
import { processPpgForHrv } from '../utils/hrvMath';
import { checkSignalQuality, PPGBandpassFilter } from '../utils/ppgFilter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  morning: '🌅 Morning Check',
  pre_breathing: '🧘 Pre-Breathing',
  post_breathing: '🌿 Post-Breathing',
  spot_check: '⚡ Spot Check',
};

export const ScannerScreen: React.FC = () => {
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const {
    isScanning,
    isPaused,
    scanType,
    elapsedSeconds,
    targetDurationSeconds,
    liveBpm,
    liveSqi,
    isFingerDetected,
    sqiReasons,
    liveWaveform,
    latestScan,
    baseline,
    startScan,
    stopScan,
    tickElapsed,
    updateLiveMetrics,
    saveCompletedScan,
    loadInitialData,
  } = useHealthStore();

  const [selectedScanType, setSelectedScanType] = useState<ScanType>('morning');
  const [showSummary, setShowSummary] = useState(false);
  const [isProcessingFinal, setIsProcessingFinal] = useState(false);

  // Streaming IIR filter & data accumulation buffers
  const filterRef = useRef(new PPGBandpassFilter(30, 0.5, 4.0));
  const rawSamplesRef = useRef<number[]>([]);
  const timestampsRef = useRef<number[]>([]);
  const recentWindowRef = useRef<number[]>([]);
  const lastBpmCalcTimeRef = useRef<number>(0);

  // Initialize DB data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Request camera permission on mount if needed
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // 1-second interval timer for 60-second scan
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isScanning && !isPaused) {
      timer = setInterval(() => {
        tickElapsed();
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isScanning, isPaused, tickElapsed]);

  // Lock camera exposure & white balance once camera starts streaming
  const lockCameraControls = useCallback(async () => {
    try {
      const controller = cameraRef.current?.controller;
      if (controller) {
        if (controller.device?.supportsExposureLocking) {
          await controller.lockCurrentExposure();
        }
        if (controller.device?.supportsWhiteBalanceLocking) {
          await controller.lockCurrentWhiteBalance();
        }
      }
    } catch {
      // Ignored if device does not support locking
    }
  }, []);

  // Process incoming raw red brightness sample on JS thread
  const handleIncomingSample = useCallback(
    (redValue: number, timestampMs: number) => {
      if (!isScanning) return;

      // Accumulate for 60s final metric calculation
      rawSamplesRef.current.push(redValue);
      timestampsRef.current.push(timestampMs);

      // Streaming bandpass filter output
      const filteredSample = filterRef.current.process(redValue);

      // Maintain 3-second sliding window for instant SQI and live BPM
      const recent = recentWindowRef.current;
      recent.push(redValue);
      if (recent.length > 90) recent.shift(); // 90 frames @ 30fps = 3s

      // Update SQI & live BPM every 15 frames (~0.5s)
      const now = Date.now();
      if (now - lastBpmCalcTimeRef.current > 500 && recent.length >= 30) {
        lastBpmCalcTimeRef.current = now;
        const sqi = checkSignalQuality(recent, 30);
        const fingerOn = sqi.sqi > 20 && !sqi.isClipped;

        // Estimate instant BPM from recent window if SQI is acceptable
        let currentBpm = liveBpm;
        if (sqi.isAcceptable && recent.length >= 60) {
          const quickAnalysis = processPpgForHrv(recent, undefined, 30);
          if (quickAnalysis.avgBpm >= 40 && quickAnalysis.avgBpm <= 180) {
            currentBpm = quickAnalysis.avgBpm;
          }
        }

        updateLiveMetrics(
          currentBpm,
          sqi.sqi,
          filteredSample,
          fingerOn,
          sqi.reasons
        );
      } else {
        // Just stream the waveform point between SQI checks
        updateLiveMetrics(
          liveBpm,
          liveSqi,
          filteredSample,
          isFingerDetected,
          sqiReasons
        );
      }
    },
    [isScanning, liveBpm, liveSqi, isFingerDetected, sqiReasons, updateLiveMetrics]
  );

  const onSampleFromWorklet = useRunOnJS(handleIncomingSample, [handleIncomingSample]);

  // Frame processor output via react-native-worklets-core
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    targetResolution: { width: 128, height: 128 },
    onFrame(frame) {
      'worklet';
      let avgRed = 0;
      try {
        if (frame.hasPixelBuffer) {
          const buffer = frame.getPixelBuffer();
          const uint8 = new Uint8Array(buffer);
          const width = frame.width;
          const height = frame.height;

          // Sample center 50x50 region
          const startX = Math.max(0, Math.floor((width - 50) / 2));
          const startY = Math.max(0, Math.floor((height - 50) / 2));
          const endX = Math.min(width, startX + 50);
          const endY = Math.min(height, startY + 50);

          let sumRed = 0;
          let count = 0;
          const bpp = frame.bytesPerRow > 0 ? Math.floor(frame.bytesPerRow / width) : 4;

          for (let y = startY; y < endY; y += 2) {
            const rowOffset = y * (frame.bytesPerRow || width * bpp);
            for (let x = startX; x < endX; x += 2) {
              const pixelIdx = rowOffset + x * bpp;
              if (pixelIdx < uint8.length) {
                sumRed += uint8[pixelIdx]; // Red channel
                count++;
              }
            }
          }
          if (count > 0) {
            avgRed = sumRed / count;
          }
        }
      } catch {
        avgRed = 0;
      } finally {
        onSampleFromWorklet(avgRed, frame.timestamp || Date.now());
        frame.dispose();
      }
    },
  });

  // Check for 60s completion
  useEffect(() => {
    if (isScanning && elapsedSeconds >= targetDurationSeconds && !isProcessingFinal) {
      handleScanComplete();
    }
  }, [isScanning, elapsedSeconds, targetDurationSeconds, isProcessingFinal]);

  const handleStart = () => {
    rawSamplesRef.current = [];
    timestampsRef.current = [];
    recentWindowRef.current = [];
    filterRef.current.reset();
    setShowSummary(false);
    startScan(selectedScanType);
    lockCameraControls();
  };

  const handleStop = () => {
    stopScan();
  };

  const handleScanComplete = async () => {
    setIsProcessingFinal(true);
    stopScan();

    const raw = rawSamplesRef.current;
    const timestamps = timestampsRef.current;

    if (raw.length < 150) {
      Alert.alert(
        'Scan Incomplete',
        'Not enough data collected. Please rest your finger lightly over the camera and flash and try again.'
      );
      setIsProcessingFinal(false);
      return;
    }

    // Process complete 60s window through full HRV mathematical pipeline
    const result = processPpgForHrv(raw, timestamps, 30, baseline);

    if (result.acceptedIntervalsCount < 10) {
      Alert.alert(
        'Low Signal Quality',
        'Excessive noise or motion detected during the scan. Please keep your hand relaxed and try again.'
      );
      setIsProcessingFinal(false);
      return;
    }

    // Auto-save to SQLite
    try {
      await saveCompletedScan({
        timestamp: new Date().toISOString(),
        avgBpm: result.avgBpm,
        sdnnMs: result.sdnnMs,
        rmssdMs: result.rmssdMs,
        stressScore: result.stressScore,
        readinessScore: result.readinessScore,
        sqiScore: result.sqi.sqi,
        rrIntervals: result.acceptedRrIntervals,
        notes: `Type: ${SCAN_TYPE_LABELS[selectedScanType]}`,
      });
      setShowSummary(true);
    } catch (err) {
      Alert.alert('Save Error', 'Failed to save HRV scan to local database.');
    } finally {
      setIsProcessingFinal(false);
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.headerTitle}>Camera Permission Required</Text>
        <Text style={styles.subtext}>
          HushBeat requires camera access to detect pulsatile blood flow from your fingertip via photoplethysmography (PPG).
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.headerTitle}>No Rear Camera Found</Text>
        <Text style={styles.subtext}>A rear-facing camera is required for fingertip PPG scanning.</Text>
      </View>
    );
  }

  const remainingSeconds = Math.max(0, targetDurationSeconds - elapsedSeconds);
  const progressPercent = Math.min(100, Math.round((elapsedSeconds / targetDurationSeconds) * 100));

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer} bounces={false}>
      {/* Hidden/Minimized native camera view (torch enabled during scan) */}
      <View style={styles.cameraPreviewContainer}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isScanning}
          outputs={[frameOutput]}
          torchMode={isScanning ? 'on' : 'off'}
          onPreviewStarted={lockCameraControls}
        />
        <View style={styles.cameraOverlay}>
          <Text style={styles.cameraOverlayText}>
            {isScanning ? 'Torch ON • Reading PPG' : 'Camera Standby'}
          </Text>
        </View>
      </View>

      {/* Header & Scan Type Selector */}
      <View style={styles.headerContainer}>
        <Text style={styles.screenHeading}>PPG Cardiac Scan</Text>
        <Text style={styles.screenSubheading}>
          Rest your index fingertip gently over the camera lens & flash.
        </Text>

        {!isScanning && !showSummary && (
          <View style={styles.selectorContainer}>
            {(['morning', 'pre_breathing', 'post_breathing', 'spot_check'] as ScanType[]).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.selectorChip,
                  selectedScanType === type && styles.selectorChipActive,
                ]}
                onPress={() => setSelectedScanType(type)}
              >
                <Text
                  style={[
                    styles.selectorChipText,
                    selectedScanType === type && styles.selectorChipTextActive,
                  ]}
                >
                  {SCAN_TYPE_LABELS[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Live Waveform & Biometric Dashboard */}
      {isScanning && (
        <View style={styles.dashboardCard}>
          {/* Top badges: Live BPM & SQI */}
          <View style={styles.metricRow}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>LIVE HEART RATE</Text>
              <Text style={styles.metricValue}>
                {liveBpm > 0 ? Math.round(liveBpm) : '--'} <Text style={styles.metricUnit}>BPM</Text>
              </Text>
            </View>

            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>SIGNAL QUALITY</Text>
              <View
                style={[
                  styles.sqiBadge,
                  liveSqi >= 75
                    ? styles.sqiGood
                    : liveSqi >= 60
                    ? styles.sqiModerate
                    : styles.sqiPoor,
                ]}
              >
                <Text style={styles.sqiText}>{liveSqi}% SQI</Text>
              </View>
            </View>
          </View>

          {/* Scrolling Pulse Waveform */}
          <View style={styles.waveformContainer}>
            <Text style={styles.waveformTitle}>PULSE WAVEFORM (AC)</Text>
            <View style={styles.barsContainer}>
              {liveWaveform.slice(-50).map((sample, idx) => {
                // Normalize sample to bar height 4 - 55 px
                const clamped = Math.max(-15, Math.min(15, sample));
                const barHeight = Math.max(4, Math.round(((clamped + 15) / 30) * 55));
                return (
                  <View
                    key={idx}
                    style={[
                      styles.waveformBar,
                      { height: barHeight, backgroundColor: isPaused ? '#FF453A' : '#30D158' },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          {/* Pause / Guidance Warning if SQI is poor */}
          {isPaused && (
            <View style={styles.pauseWarningBanner}>
              <Text style={styles.pauseWarningTitle}>⚠️ Scan Paused — Low Signal Quality</Text>
              <Text style={styles.pauseWarningText}>
                {sqiReasons.length > 0
                  ? sqiReasons[0]
                  : 'Place your fingertip lightly over both the camera and LED flash. Do not press hard.'}
              </Text>
            </View>
          )}

          {/* Countdown Timer & Progress Bar */}
          <View style={styles.timerSection}>
            <View style={styles.timerHeader}>
              <Text style={styles.timerLabel}>Collecting 60-second window...</Text>
              <Text style={styles.timerDigits}>{remainingSeconds}s</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>
        </View>
      )}

      {/* Scan Summary Card (Auto-saved) */}
      {showSummary && latestScan && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>🎉 60-Second Scan Complete</Text>
          <Text style={styles.summarySubtitle}>
            Saved to local offline database • {new Date(latestScan.timestamp).toLocaleTimeString()}
          </Text>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Average BPM</Text>
              <Text style={styles.summaryItemValue}>{Math.round(latestScan.avgBpm)}</Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>SDNN (Overall)</Text>
              <Text style={styles.summaryItemValue}>{latestScan.sdnnMs} <Text style={styles.unitSmall}>ms</Text></Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>RMSSD (Vagal)</Text>
              <Text style={styles.summaryItemValue}>{latestScan.rmssdMs} <Text style={styles.unitSmall}>ms</Text></Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Stress Score</Text>
              <Text style={[styles.summaryItemValue, latestScan.stressScore > 65 ? styles.highStress : styles.lowStress]}>
                {latestScan.stressScore}/100
              </Text>
            </View>
          </View>

          <View style={styles.readinessBanner}>
            <Text style={styles.readinessBannerLabel}>AUTONOMIC READINESS SCORE</Text>
            <Text style={styles.readinessBannerScore}>{latestScan.readinessScore}/100</Text>
            <Text style={styles.readinessBannerSub}>
              {latestScan.readinessScore >= 75
                ? 'Prime recovery. Autonomic nervous system balanced.'
                : latestScan.readinessScore >= 50
                ? 'Moderate recovery. Pacing recommended.'
                : 'Fatigue detected. Consider rest and biofeedback breathing.'}
            </Text>
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={handleStart}>
            <Text style={styles.primaryButtonText}>Start New Scan</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Action Buttons */}
      <View style={styles.actionsContainer}>
        {!isScanning ? (
          !showSummary && (
            <TouchableOpacity style={styles.startButton} onPress={handleStart}>
              <Text style={styles.startButtonText}>Start 60s HRV Scan</Text>
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={handleStop}>
            <Text style={styles.stopButtonText}>Cancel Scan</Text>
          </TouchableOpacity>
        )}

        {isProcessingFinal && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color="#0A84FF" />
            <Text style={styles.processingText}>Computing HRV & Sub-Frame R-R Intervals...</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    paddingBottom: 40,
    backgroundColor: '#0A0A0C',
    minHeight: '100%',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0A0A0C',
  },
  cameraPreviewContainer: {
    width: '100%',
    height: 120,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
    position: 'relative',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cameraOverlayText: {
    color: '#EBEBF5',
    fontSize: 12,
    fontWeight: '500',
  },
  headerContainer: {
    padding: 20,
  },
  screenHeading: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  screenSubheading: {
    color: '#8E8E93',
    fontSize: 14,
    marginTop: 4,
  },
  selectorContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    gap: 8,
  },
  selectorChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  selectorChipActive: {
    backgroundColor: '#0A84FF',
    borderColor: '#0A84FF',
  },
  selectorChipText: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
  },
  selectorChipTextActive: {
    color: '#FFFFFF',
  },
  dashboardCard: {
    marginHorizontal: 16,
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#242426',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  metricBox: {
    flex: 1,
  },
  metricLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 2,
  },
  metricUnit: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  sqiBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  sqiGood: { backgroundColor: '#30D158' },
  sqiModerate: { backgroundColor: '#FFD60A' },
  sqiPoor: { backgroundColor: '#FF453A' },
  sqiText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  waveformContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#0F0F11',
    borderRadius: 12,
  },
  waveformTitle: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 60,
    gap: 3,
  },
  waveformBar: {
    flex: 1,
    borderRadius: 2,
  },
  pauseWarningBanner: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#3A1414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF453A',
  },
  pauseWarningTitle: {
    color: '#FF453A',
    fontWeight: '700',
    fontSize: 13,
  },
  pauseWarningText: {
    color: '#EBEBF5',
    fontSize: 12,
    marginTop: 2,
  },
  timerSection: {
    marginTop: 16,
  },
  timerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  timerLabel: {
    color: '#8E8E93',
    fontSize: 12,
  },
  timerDigits: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#2C2C2E',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0A84FF',
    borderRadius: 3,
  },
  summaryCard: {
    marginHorizontal: 16,
    backgroundColor: '#161618',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#242426',
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  summarySubtitle: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryItem: {
    width: (SCREEN_WIDTH - 32 - 40 - 12) / 2,
    backgroundColor: '#0F0F11',
    borderRadius: 12,
    padding: 12,
  },
  summaryItemLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
  },
  summaryItemValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  unitSmall: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '400',
  },
  highStress: { color: '#FF453A' },
  lowStress: { color: '#30D158' },
  readinessBanner: {
    marginTop: 16,
    backgroundColor: '#0C2A4A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  readinessBannerLabel: {
    color: '#5AC8FA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  readinessBannerScore: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    marginVertical: 2,
  },
  readinessBannerSub: {
    color: '#D1E8FF',
    fontSize: 12,
  },
  actionsContainer: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  startButton: {
    backgroundColor: '#0A84FF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
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
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#0A84FF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  processingOverlay: {
    marginTop: 16,
    alignItems: 'center',
    padding: 16,
  },
  processingText: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 8,
  },
  subtext: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
});
