/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  HardDrive, 
  Smartphone, 
  Wifi, 
  Image as ImageIcon, 
  Terminal, 
  Plus, 
  RefreshCw, 
  CheckCircle2, 
  ArrowRight,
  ShieldCheck,
  Zap,
  Play
} from 'lucide-react';
import type { Device, PhotoRecord, StorageConfig, StorageStats, SyncLogEvent } from './types';
import { Header } from './components/Header';
import { StorageOverview } from './components/StorageOverview';
import { DeviceCard } from './components/DeviceCard';
import { IosShortcutsModal } from './components/IosShortcutsModal';
import { ScheduleModal } from './components/ScheduleModal';
import { SettingsModal } from './components/SettingsModal';
import { FolderStructurePreview } from './components/FolderStructurePreview';
import { GalleryView } from './components/GalleryView';
import { SyncLogsView } from './components/SyncLogsView';
import { MobileSyncView } from './components/MobileSyncView';
import { PcSetupGuide } from './components/PcSetupGuide';
import { Monitor } from 'lucide-react';

export default function App() {
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [logs, setLogs] = useState<SyncLogEvent[]>([]);
  const [networkInfo, setNetworkInfo] = useState<{
    primaryIp: string;
    port: number;
    fullUrl: string;
    hostname: string;
    wifiSsid: string;
  } | null>(null);
  const [isConnectedSse, setIsConnectedSse] = useState(false);

  // View state
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'pc_guide' | 'gallery' | 'logs'>('dashboard');

  // Modal controls
  const [shortcutsModalDevice, setShortcutsModalDevice] = useState<Device | null>(null);
  const [scheduleModalDevice, setScheduleModalDevice] = useState<Device | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showFolderTree, setShowFolderTree] = useState(false);
  const [showMobileSync, setShowMobileSync] = useState(false);

  // Simulation loading state
  const [isSimulating, setIsSimulating] = useState(false);
  const [syncingDeviceId, setSyncingDeviceId] = useState<string | null>(null);

  // Fetch all initial data
  const fetchData = useCallback(async () => {
    try {
      const [configRes, devRes, photosRes, logsRes, netRes] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/devices').then((r) => r.json()),
        fetch('/api/photos').then((r) => r.json()),
        fetch('/api/logs').then((r) => r.json()),
        fetch('/api/system/network').then((r) => r.json()),
      ]);

      if (configRes) {
        setConfig(configRes.config);
        setStats(configRes.stats);
      }
      if (devRes) setDevices(devRes.devices || []);
      if (photosRes) setPhotos(photosRes.photos || []);
      if (logsRes) setLogs(logsRes.logs || []);
      if (netRes) setNetworkInfo(netRes);
    } catch (err) {
      console.error('Failed to load LocalVault data', err);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Check if launched with mobile param
    const params = new URLSearchParams(window.location.search);
    if (params.get('mobile') === 'true') {
      setShowMobileSync(true);
    }

    // Set up Server-Sent Events (SSE) for live backup sync notifications
    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setIsConnectedSse(true);
    };

    eventSource.onerror = () => {
      setIsConnectedSse(false);
    };

    eventSource.addEventListener('photo_synced', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.photo) {
          setPhotos((prev) => [payload.photo, ...prev]);
        }
        if (payload.log) {
          setLogs((prev) => [payload.log, ...prev]);
        }
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.addEventListener('sync_batch_completed', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.photos) {
          setPhotos((prev) => [...payload.photos, ...prev]);
        }
        if (payload.log) {
          setLogs((prev) => [payload.log, ...prev]);
        }
        fetchData();
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.addEventListener('stats_updated', (e: any) => {
      try {
        setStats(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.addEventListener('devices_updated', (e: any) => {
      try {
        setDevices(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.addEventListener('config_updated', (e: any) => {
      try {
        setConfig(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.addEventListener('photo_deleted', (e: any) => {
      try {
        const { id } = JSON.parse(e.data);
        setPhotos((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        console.error(err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [fetchData]);

  // Simulate automated sync trigger
  const handleSimulateSync = async (targetDeviceId?: string) => {
    const devId = targetDeviceId || devices[0]?.id || 'iphone-1';
    setIsSimulating(true);
    setSyncingDeviceId(devId);

    try {
      await fetch('/api/test/simulate-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: devId, count: 4 }),
      });
      await fetchData();
    } catch (err) {
      console.error('Simulate sync failed', err);
    } finally {
      setIsSimulating(false);
      setSyncingDeviceId(null);
    }
  };

  // Save updated device schedule
  const handleSaveSchedule = async (updatedDevice: Device) => {
    try {
      await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDevice),
      });
      fetchData();
    } catch (err) {
      console.error('Save schedule failed', err);
    }
  };

  // Save updated configuration
  const handleSaveSettings = async (updatedConfig: Partial<StorageConfig>) => {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      fetchData();
    } catch (err) {
      console.error('Save settings failed', err);
    }
  };

  // Delete photo from vault
  const handleDeletePhoto = async (id: string) => {
    try {
      await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      fetchData();
    } catch (err) {
      console.error('Delete photo failed', err);
    }
  };

  if (!config || !stats) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 font-medium">Initializing LocalVault PC SSD Server...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-sky-500 selection:text-white">
      
      {/* Top Header */}
      <Header
        config={config}
        networkInfo={networkInfo}
        isConnectedSse={isConnectedSse}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShortcutsModalDevice(devices[0] || null)}
        onOpenMobileSync={() => setShowMobileSync(true)}
        onOpenPcGuide={() => setCurrentTab('pc_guide')}
        onSimulateSync={() => handleSimulateSync()}
        isSimulating={isSimulating}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 space-y-6">
        
        {/* Navigation Tabs (Dashboard, PC + SSD Guide, Gallery, Activity Logs) */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-4 h-4 text-sky-400" />
              <span>Dual iPhone Hub</span>
            </button>
            <button
              onClick={() => setCurrentTab('pc_guide')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                currentTab === 'pc_guide'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-4 h-4 text-emerald-400" />
              <span>PC + SSD Setup (No Pi)</span>
            </button>
            <button
              onClick={() => setCurrentTab('gallery')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                currentTab === 'gallery'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-4 h-4 text-indigo-400" />
              <span>SSD Photo Vault ({photos.length})</span>
            </button>
            <button
              onClick={() => setCurrentTab('logs')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                currentTab === 'logs'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>Activity & Sync Logs</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Wi-Fi Network: <strong className="text-white">{config.homeWifiSsid}</strong></span>
          </div>
        </div>

        {/* TAB 1: DASHBOARD & DEVICES */}
        {currentTab === 'dashboard' && (
          <div className="space-y-6">
            
            {/* External SSD Storage Metric Bar */}
            <StorageOverview
              config={config}
              stats={stats}
              onOpenFolderTree={() => setShowFolderTree(true)}
              onOpenSettings={() => setShowSettings(true)}
            />

            {/* Dual iPhone Cards Section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">Registered iPhones on Same Wi-Fi</h2>
                  <p className="text-xs text-slate-400">Independent automatic delta backup schedules and separate SSD folders</p>
                </div>

                <button
                  onClick={() => setShowMobileSync(true)}
                  className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Pair or Add Device</span>
                </button>
              </div>

              {/* Grid of the 2 iPhones */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {devices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onSelectShortcut={(dev) => setShortcutsModalDevice(dev)}
                    onEditSchedule={(dev) => setScheduleModalDevice(dev)}
                    onTriggerSync={(dev) => handleSimulateSync(dev.id)}
                    isSyncing={syncingDeviceId === device.id}
                  />
                ))}
              </div>
            </div>

            {/* How It Works Architecture Guide Card */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">How This Replaces Raspberry Pi & Cloud Subscriptions</h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">Zero Subscription · 100% Local LAN</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <span className="font-semibold text-sky-400 block flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-950 text-sky-400 flex items-center justify-center text-[11px] font-bold">1</span>
                    Connected to Your PC SSD
                  </span>
                  <p className="text-slate-400 leading-relaxed">
                    Instead of a slow Raspberry Pi SD card, your external SSD directly uses PC USB 3.2 / NVMe bus speeds with no throttling or power under-voltage issues.
                  </p>
                </div>

                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <span className="font-semibold text-indigo-400 block flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-950 text-indigo-400 flex items-center justify-center text-[11px] font-bold">2</span>
                    Automated via Apple Shortcuts
                  </span>
                  <p className="text-slate-400 leading-relaxed">
                    iOS automatically runs when connecting to your home Wi-Fi or when plugged into charger on your nightstand. Runs in the background silently.
                  </p>
                </div>

                <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                  <span className="font-semibold text-emerald-400 block flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center text-[11px] font-bold">3</span>
                    SHA-256 Deduplication
                  </span>
                  <p className="text-slate-400 leading-relaxed">
                    Every photo is checksummed before writing. Repeated backups only transfer new photos taken since last sync, saving gigabytes of SSD space.
                  </p>
                </div>
              </div>
            </div>

            {/* Recent Activity Mini-stream */}
            <SyncLogsView
              logs={logs.slice(0, 5)}
              isConnectedSse={isConnectedSse}
            />

          </div>
        )}

        {/* TAB 2: PC + EXTERNAL SSD SETUP GUIDE */}
        {currentTab === 'pc_guide' && (
          <PcSetupGuide
            config={config}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        {/* TAB 3: SSD PHOTO VAULT GALLERY */}
        {currentTab === 'gallery' && (
          <GalleryView
            photos={photos}
            devices={devices}
            onDeletePhoto={handleDeletePhoto}
          />
        )}

        {/* TAB 3: COMPLETE ACTIVITY & LOGS */}
        {currentTab === 'logs' && (
          <SyncLogsView
            logs={logs}
            isConnectedSse={isConnectedSse}
          />
        )}

      </main>

      {/* iOS Shortcuts & Automation Wizard Modal */}
      {shortcutsModalDevice && (
        <IosShortcutsModal
          device={shortcutsModalDevice}
          config={config}
          networkInfo={networkInfo}
          onClose={() => setShortcutsModalDevice(null)}
        />
      )}

      {/* Schedule & Trigger Config Modal */}
      {scheduleModalDevice && (
        <ScheduleModal
          device={scheduleModalDevice}
          homeWifiSsid={config.homeWifiSsid}
          onSave={handleSaveSchedule}
          onClose={() => setScheduleModalDevice(null)}
        />
      )}

      {/* Settings Modal (SSD Path, Wi-Fi SSID, etc.) */}
      {showSettings && (
        <SettingsModal
          config={config}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Folder Structure Inspector Modal */}
      {showFolderTree && (
        <FolderStructurePreview
          config={config}
          devices={devices}
          photos={photos}
          onClose={() => setShowFolderTree(false)}
        />
      )}

      {/* Mobile Web Upload Companion Modal */}
      {showMobileSync && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <MobileSyncView
            devices={devices}
            config={config}
            onUploadSuccess={fetchData}
            onClose={() => setShowMobileSync(false)}
            defaultDeviceId={devices[0]?.id}
          />
        </div>
      )}

    </div>
  );
}
