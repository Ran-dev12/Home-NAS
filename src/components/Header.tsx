import React, { useState } from 'react';
import { 
  HardDrive, 
  Wifi, 
  Smartphone, 
  Play, 
  Settings, 
  Copy, 
  Check, 
  Sparkles,
  QrCode,
  ShieldCheck,
  RefreshCw,
  Monitor
} from 'lucide-react';
import type { StorageConfig } from '../types';

interface HeaderProps {
  config: StorageConfig;
  networkInfo: {
    primaryIp: string;
    port: number;
    fullUrl: string;
    hostname: string;
    wifiSsid: string;
  } | null;
  isConnectedSse: boolean;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenMobileSync: () => void;
  onOpenPcGuide: () => void;
  onSimulateSync: () => void;
  isSimulating: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  networkInfo,
  isConnectedSse,
  onOpenSettings,
  onOpenShortcuts,
  onOpenMobileSync,
  onOpenPcGuide,
  onSimulateSync,
  isSimulating,
}) => {
  const [copied, setCopied] = useState(false);

  const lanUrl = networkInfo?.fullUrl || `http://${config.pcLocalIp || '192.168.1.105'}:${config.serverPort || 3000}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(lanUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30 px-4 lg:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Brand & Server Identity */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-semibold">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">LocalVault</h1>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                PC SSD Gateway Active
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>Dual iPhone Auto Wi-Fi Sync</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-mono">{config.ssdLabel || 'External SSD'}</span>
            </div>
          </div>
        </div>

        {/* Network & Local LAN Info Bar */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          
          {/* LAN URL Pill for Phones */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-slate-300 font-mono">
            <Wifi className="w-3.5 h-3.5 text-sky-400 mr-1.5 ml-1" />
            <span className="text-slate-400 mr-1.5">LAN:</span>
            <span className="text-sky-300 font-semibold">{lanUrl}</span>
            <button
              onClick={handleCopy}
              title="Copy PC LAN URL to connect iPhone"
              className="ml-2 p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Wi-Fi SSID */}
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 bg-slate-900/80 border border-slate-800 rounded-lg text-slate-400">
            <span className="text-slate-500">Wi-Fi:</span>
            <span className="text-slate-200 font-medium">{config.homeWifiSsid}</span>
          </div>

          {/* Target SSD Path */}
          <div className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 bg-slate-900/80 border border-slate-800 rounded-lg text-slate-400">
            <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-500">SSD:</span>
            <span className="text-slate-300 font-mono text-[11px] truncate max-w-[140px]" title={config.ssdMountPath}>
              {config.ssdMountPath}
            </span>
          </div>

        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2">
          
          {/* PC Setup Guide */}
          <button
            onClick={onOpenPcGuide}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-sm shadow-emerald-600/30 transition-colors cursor-pointer"
            title="View commands to run on your PC with connected SSD"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>PC + SSD Setup</span>
          </button>

          {/* Simulate Auto Backup */}
          <button
            onClick={onSimulateSync}
            disabled={isSimulating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium rounded-lg border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            title="Simulate automated Wi-Fi trigger for testing"
          >
            <Play className={`w-3.5 h-3.5 text-sky-400 ${isSimulating ? 'animate-spin' : ''}`} />
            <span>{isSimulating ? 'Simulating...' : 'Test Auto Sync'}</span>
          </button>

          {/* iOS Shortcuts Setup */}
          <button
            onClick={onOpenShortcuts}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg shadow-sm shadow-sky-600/30 transition-colors cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>iOS Auto Shortcut</span>
          </button>

          {/* Mobile Web Upload Companion */}
          <button
            onClick={onOpenMobileSync}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg border border-indigo-500/30 transition-colors cursor-pointer"
            title="Open iPhone Wi-Fi Web Backup companion"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pair & Sync</span>
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer"
            title="Configure SSD Path & Network Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};
