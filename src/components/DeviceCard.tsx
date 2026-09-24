import React from 'react';
import { 
  Smartphone, 
  Wifi, 
  BatteryCharging, 
  Clock, 
  CheckCircle2, 
  RotateCw, 
  QrCode, 
  Sliders, 
  HardDrive,
  Folder
} from 'lucide-react';
import type { Device } from '../types';
import { formatBytes, formatDate } from '../utils/qr';

interface DeviceCardProps {
  device: Device;
  onSelectShortcut: (device: Device) => void;
  onEditSchedule: (device: Device) => void;
  onTriggerSync: (device: Device) => void;
  isSyncing: boolean;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onSelectShortcut,
  onEditSchedule,
  onTriggerSync,
  isSyncing,
}) => {
  const schedule = device.syncSchedule;

  const getTriggerLabel = () => {
    switch (schedule.triggerType) {
      case 'charging':
        return `Nightly while charging (${schedule.dailyTime || '02:00 AM'})`;
      case 'wifi_connect':
        return `When connecting to "${schedule.wifiSsid || 'Home Wi-Fi'}"`;
      case 'daily':
        return `Daily at ${schedule.dailyTime || '03:00'}`;
      case 'interval':
        return `Every ${schedule.intervalMinutes || 180} minutes`;
      default:
        return 'Automated on Wi-Fi';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-5 shadow-lg relative flex flex-col justify-between hover:border-slate-700/80 transition-all group">
      
      {/* Top Header with Device Color Pill */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md relative"
              style={{ backgroundColor: device.color }}
            >
              <Smartphone className="w-6 h-6" />
              {/* Online Wi-Fi badge */}
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">{device.name}</h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{device.model}</span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-300">Owner: {device.owner}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onEditSchedule(device)}
              title="Configure auto-sync trigger rules"
              className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 rounded-lg border border-slate-700/50 transition-colors cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
            </button>
            <button
              onClick={() => onSelectShortcut(device)}
              title="View iOS Shortcut instructions & QR Code"
              className="p-1.5 text-sky-400 hover:text-sky-300 bg-sky-950/50 hover:bg-sky-900/50 rounded-lg border border-sky-800/50 transition-colors cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Schedule & Trigger Status Banner */}
        <div className="mt-4 bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <RotateCw className="w-3 h-3 text-sky-400" />
              Automatic Routine:
            </span>
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Active
            </span>
          </div>
          <div className="text-xs font-medium text-slate-200 flex items-center gap-2">
            {schedule.triggerType === 'charging' ? (
              <BatteryCharging className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Wifi className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )}
            <span className="truncate">{getTriggerLabel()}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
            <span>Last Sync: {formatDate(device.lastSyncAt)}</span>
            <span aria-hidden="true">·</span>
            <span>IP: {device.ipAddress || '192.168.1.x'}</span>
          </div>
        </div>

        {/* Backup Volume & Photo Stats */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="bg-slate-950/40 border border-slate-800/40 rounded-lg py-2 px-1">
            <span className="text-[10px] text-slate-500 block uppercase font-medium">Photos</span>
            <span className="text-sm font-bold text-white">{device.totalPhotosSynced.toLocaleString()}</span>
          </div>
          <div className="bg-slate-950/40 border border-slate-800/40 rounded-lg py-2 px-1">
            <span className="text-[10px] text-slate-500 block uppercase font-medium">Videos</span>
            <span className="text-sm font-bold text-white">{device.totalVideosSynced.toLocaleString()}</span>
          </div>
          <div className="bg-slate-950/40 border border-slate-800/40 rounded-lg py-2 px-1">
            <span className="text-[10px] text-slate-500 block uppercase font-medium">SSD Size</span>
            <span className="text-sm font-bold text-sky-400">{formatBytes(device.totalBytesSynced)}</span>
          </div>
        </div>

      </div>

      {/* Action Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between gap-2">
        <button
          onClick={() => onSelectShortcut(device)}
          className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Setup iOS Automation</span>
        </button>

        <button
          onClick={() => onTriggerSync(device)}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 text-sky-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Backing up...' : 'Delta Sync Now'}</span>
        </button>
      </div>

    </div>
  );
};
