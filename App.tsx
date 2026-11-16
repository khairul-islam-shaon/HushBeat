/**
 * HushBeat - Main Application Root & Navigation
 *
 * Offline-first personal health app:
 * - 4 Navigation Tabs:
 *   1. Dashboard: Daily Readiness Score, 14-day SDNN trend, watch biometrics & habit logging
 *   2. Scan SDNN: 60-second rear-camera PPG pulse acquisition with SQI gate & R-R outlier rejection
 *   3. Breathe: 3-minute resonance breathing pacer (5.5s inhale / 5.5s exhale) with biofeedback
 *   4. Recovery HRR: Post-workout Heart Rate Recovery timer (1-min and 2-min drop with vagal rebound rating)
 *
 * 100% local-first SQLite persistence. Zero cloud. Zero network telemetry.
 */

import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { initDatabase } from './src/db/database';
import { BreathingScreen } from './src/screens/BreathingScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { RecoveryTimerScreen } from './src/screens/RecoveryTimerScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { ScanType, useHealthStore } from './src/store/useHealthStore';

export type AppTab = 'dashboard' | 'scanner' | 'breathing' | 'recovery';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const { startScan } = useHealthStore();

  useEffect(() => {
    initDatabase().catch((err) => {
      console.warn('Failed to initialize SQLite database:', err);
    });
  }, []);

  const handleNavigateFromDashboard = (tab: 'scanner' | 'breathing' | 'recovery', scanType?: ScanType) => {
    setActiveTab(tab);
    if (tab === 'scanner' && scanType) {
      startScan(scanType);
    }
  };

  const handleNavigateToScannerFromBreathing = (type: 'pre_breathing' | 'post_breathing') => {
    setActiveTab('scanner');
    startScan(type);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Top Application Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appTitle}>HushBeat</Text>
          <Text style={styles.appSubtitle}>Offline-First Autonomic Health</Text>
        </View>

        <View style={styles.offlineBadge}>
          <Text style={styles.offlineBadgeDot}>●</Text>
          <Text style={styles.offlineBadgeText}>100% Local</Text>
        </View>
      </View>

      {/* Main Screen Content */}
      <View style={styles.screenContainer}>
        {activeTab === 'dashboard' && (
          <DashboardScreen onNavigateToTab={handleNavigateFromDashboard} />
        )}
        {activeTab === 'scanner' && <ScannerScreen />}
        {activeTab === 'breathing' && (
          <BreathingScreen onNavigateToScanner={handleNavigateToScannerFromBreathing} />
        )}
        {activeTab === 'recovery' && <RecoveryTimerScreen />}
      </View>

      {/* Cohesive Biometric Bottom Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.navItem, activeTab === 'dashboard' && styles.navItemActive]}
          onPress={() => setActiveTab('dashboard')}
        >
          <Text style={[styles.navIcon, activeTab === 'dashboard' && styles.navIconActive]}>
            📊
          </Text>
          <Text style={[styles.navLabel, activeTab === 'dashboard' && styles.navLabelActive]}>
            Dashboard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'scanner' && styles.navItemActive]}
          onPress={() => setActiveTab('scanner')}
        >
          <Text style={[styles.navIcon, activeTab === 'scanner' && styles.navIconActive]}>
            💓
          </Text>
          <Text style={[styles.navLabel, activeTab === 'scanner' && styles.navLabelActive]}>
            Scan SDNN
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'breathing' && styles.navItemActive]}
          onPress={() => setActiveTab('breathing')}
        >
          <Text style={[styles.navIcon, activeTab === 'breathing' && styles.navIconActive]}>
            🧘
          </Text>
          <Text style={[styles.navLabel, activeTab === 'breathing' && styles.navLabelActive]}>
            Breathe
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'recovery' && styles.navItemActive]}
          onPress={() => setActiveTab('recovery')}
        >
          <Text style={[styles.navIcon, activeTab === 'recovery' && styles.navIconActive]}>
            ⏱️
          </Text>
          <Text style={[styles.navLabel, activeTab === 'recovery' && styles.navLabelActive]}>
            Recovery HRR
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E',
    backgroundColor: '#0A0A0C',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: '#242428',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  offlineBadgeDot: {
    color: '#30D158',
    fontSize: 8,
    marginRight: 6,
  },
  offlineBadgeText: {
    color: '#D1D1D6',
    fontSize: 11,
    fontWeight: '700',
  },
  screenContainer: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: '#111113',
    borderTopWidth: 1,
    borderTopColor: '#1C1C1E',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: '#1A1A1E',
  },
  navIcon: {
    fontSize: 18,
    opacity: 0.5,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    color: '#636366',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  navLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
