import React from 'react';
import { HardDrive, ShieldCheck, Database, FolderCheck, Cpu, ArrowUpRight } from 'lucide-react';
import type { StorageConfig, StorageStats } from '../types';
import { formatBytes } from '../utils/qr';

interface StorageOverviewProps {
  config: StorageConfig;
  stats: StorageStats;
  onOpenFolderTree: () => void;
  onOpenSettings: () => void;
}

export const StorageOverview: React.FC<StorageOverviewProps> = ({
  config,
  stats,
  onOpenFolderTree,
  onOpenSettings,
}) => {
  const usedPercent = Math.min(100, Math.round((stats.usedSpaceBytes / stats.totalCapacityBytes) * 100));
  const rawVaultPercent = (stats.localVaultBytes / stats.totalCapacityBytes) * 100;
  const vaultPercent = Math.min(100, parseFloat(rawVaultPercent.toFixed(1)));

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-xl relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute -right-16 -top-16 w-64 h-64 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-slate-800 text-sky-400 border border-slate-700/60 mt-0.5">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">External PC SSD Storage</h2>
              <span className="text-xs text-slate-400 font-mono">({config.ssdLabel})</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Direct write location:{' '}
              <span className="font-mono text-slate-200 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                {config.ssdMountPath}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenFolderTree}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            <FolderCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Inspect SSD Folder Structure</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="text-xs text-sky-400 hover:text-sky-300 font-medium px-2 py-1 transition-colors cursor-pointer"
          >
            Change Path
          </button>
        </div>
      </div>

      {/* Storage Progress Bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-3">
            <span className="text-slate-300 font-medium">
              Used: <span className="text-white font-semibold">{formatBytes(stats.usedSpaceBytes)}</span>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-sky-400 font-medium">
              LocalVault Photos: <span className="font-semibold">{formatBytes(stats.localVaultBytes)}</span> ({vaultPercent}%)
            </span>
          </div>
          <span className="text-slate-400">
            Free: <span className="text-emerald-400 font-semibold">{formatBytes(stats.freeSpaceBytes)}</span> of {formatBytes(stats.totalCapacityBytes)}
          </span>
        </div>

        {/* Visual Dual Stacked Progress Bar */}
        <div className="w-full h-3.5 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800 flex">
          {/* Other used space */}
          <div 
            className="h-full bg-slate-700 rounded-l-full transition-all duration-500" 
            style={{ width: `${Math.max(2, usedPercent - Number(vaultPercent))}%` }}
            title="Other SSD files"
          />
          {/* LocalVault Photo & Video space */}
          <div 
            className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-r-full transition-all duration-500 relative group"
            style={{ width: `${Math.max(1, Number(vaultPercent))}%` }}
            title={`LocalVault: ${formatBytes(stats.localVaultBytes)}`}
          />
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-slate-800/60">
        
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Total Photos on SSD</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-white tracking-tight">{stats.totalPhotos.toLocaleString()}</span>
            <span className="text-xs text-slate-500 font-normal">items</span>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Videos & Live Clips</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-white tracking-tight">{stats.totalVideos.toLocaleString()}</span>
            <span className="text-xs text-slate-500 font-normal">videos</span>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <div className="flex items-center gap-1 text-[11px] text-emerald-400">
            <ShieldCheck className="w-3 h-3" />
            <span>Deduplication Saved</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-emerald-400 tracking-tight">
              {formatBytes(stats.totalDuplicatesSavedBytes)}
            </span>
            <span className="text-xs text-slate-500 font-normal">SSD space</span>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[11px] text-slate-400 block">Duplicate Skips</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-lg font-bold text-slate-200 tracking-tight">
              {stats.totalDuplicatesSkipped.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-normal">hashes</span>
          </div>
        </div>

      </div>
    </div>
  );
};
