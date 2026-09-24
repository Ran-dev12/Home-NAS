import React, { useState } from 'react';
import { X, Clock, BatteryCharging, Wifi, ShieldCheck, Check, Save } from 'lucide-react';
import type { Device } from '../types';

interface ScheduleModalProps {
  device: Device;
  homeWifiSsid: string;
  onSave: (updatedDevice: Device) => void;
  onClose: () => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  device,
  homeWifiSsid,
  onSave,
  onClose,
}) => {
  const [enabled, setEnabled] = useState(device.syncSchedule.enabled);
  const [triggerType, setTriggerType] = useState(device.syncSchedule.triggerType);
  const [wifiSsid, setWifiSsid] = useState(device.syncSchedule.wifiSsid || homeWifiSsid);
  const [dailyTime, setDailyTime] = useState(device.syncSchedule.dailyTime || '02:30');
  const [intervalMinutes, setIntervalMinutes] = useState(device.syncSchedule.intervalMinutes || 180);
  const [onlyOnWifi, setOnlyOnWifi] = useState(device.syncSchedule.onlyOnWifi);
  const [onlyWhileCharging, setOnlyWhileCharging] = useState(device.syncSchedule.onlyWhileCharging);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: Device = {
      ...device,
      syncSchedule: {
        enabled,
        triggerType,
        wifiSsid,
        dailyTime,
        intervalMinutes: Number(intervalMinutes),
        onlyOnWifi,
        onlyWhileCharging,
      },
    };
    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div>
            <h2 className="text-base font-bold text-white">Auto-Sync Schedule & Triggers</h2>
            <p className="text-xs text-slate-400">Configure background sync rules for {device.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          
          {/* Main Toggle */}
          <div className="flex items-center justify-between bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div>
              <span className="font-semibold text-white block">Automatic Periodic Sync</span>
              <span className="text-slate-400 text-[11px]">Keep photo library automatically synchronized to PC SSD</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
            </label>
          </div>

          {/* Trigger Types Selection */}
          <div className="space-y-2">
            <label className="text-slate-300 font-semibold block">Preferred Trigger Condition</label>
            
            <div className="grid grid-cols-1 gap-2">
              {/* Charging Option */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  triggerType === 'charging'
                    ? 'bg-slate-800/90 border-sky-500/80 text-white'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                <input
                  type="radio"
                  name="triggerType"
                  value="charging"
                  checked={triggerType === 'charging'}
                  onChange={() => setTriggerType('charging')}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-1.5 text-amber-400">
                    <BatteryCharging className="w-4 h-4" />
                    <span>Nightly While Charging (Bedside Auto-Backup)</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Runs automatically at bedtime when your phone is plugged in and idle, with zero battery drain.
                  </p>
                </div>
              </label>

              {/* Wi-Fi Connect Option */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  triggerType === 'wifi_connect'
                    ? 'bg-slate-800/90 border-sky-500/80 text-white'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                <input
                  type="radio"
                  name="triggerType"
                  value="wifi_connect"
                  checked={triggerType === 'wifi_connect'}
                  onChange={() => setTriggerType('wifi_connect')}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-1.5 text-sky-400">
                    <Wifi className="w-4 h-4" />
                    <span>When Joining Home Wi-Fi</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Triggers every time your iPhone arrives home and connects to your local network.
                  </p>
                </div>
              </label>

              {/* Periodic Interval Option */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  triggerType === 'interval'
                    ? 'bg-slate-800/90 border-sky-500/80 text-white'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                <input
                  type="radio"
                  name="triggerType"
                  value="interval"
                  checked={triggerType === 'interval'}
                  onChange={() => setTriggerType('interval')}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-1.5 text-indigo-400">
                    <Clock className="w-4 h-4" />
                    <span>Periodic Interval Schedule</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Checks for new photos periodically every few hours while on Wi-Fi.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Conditional Sub-settings */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium">Home Wi-Fi Network (SSID):</span>
              <input
                type="text"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white font-mono text-xs w-48 text-right"
              />
            </div>

            {triggerType === 'charging' && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-slate-300 font-medium">Preferred Target Time:</span>
                <input
                  type="time"
                  value={dailyTime}
                  onChange={(e) => setDailyTime(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white font-mono text-xs"
                />
              </div>
            )}

            {triggerType === 'interval' && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-slate-300 font-medium">Repeat Interval:</span>
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs"
                >
                  <option value={60}>Every 1 hour</option>
                  <option value={120}>Every 2 hours</option>
                  <option value={180}>Every 3 hours</option>
                  <option value={360}>Every 6 hours</option>
                  <option value={720}>Every 12 hours</option>
                </select>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/60 space-y-2">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyOnWifi}
                  onChange={(e) => setOnlyOnWifi(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                />
                <span>Strict Wi-Fi check (never use mobile cellular data)</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWhileCharging}
                  onChange={(e) => setOnlyWhileCharging(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                />
                <span>Pause if iPhone battery is below 20%</span>
              </label>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Schedule</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
