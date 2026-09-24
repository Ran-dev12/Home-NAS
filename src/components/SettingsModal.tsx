import React, { useState } from 'react';
import { X, HardDrive, Wifi, ShieldCheck, Layers, Save, Check } from 'lucide-react';
import type { StorageConfig } from '../types';

interface SettingsModalProps {
  config: StorageConfig;
  onSave: (updated: Partial<StorageConfig>) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  onSave,
  onClose,
}) => {
  const [ssdMountPath, setSsdMountPath] = useState(config.ssdMountPath);
  const [ssdLabel, setSsdLabel] = useState(config.ssdLabel);
  const [homeWifiSsid, setHomeWifiSsid] = useState(config.homeWifiSsid);
  const [folderNamingPattern, setFolderNamingPattern] = useState(config.folderNamingPattern);
  const [deduplicationEnabled, setDeduplicationEnabled] = useState(config.deduplicationEnabled);
  const [preserveLivePhotos, setPreserveLivePhotos] = useState(config.preserveLivePhotos);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ssdMountPath,
      ssdLabel,
      homeWifiSsid,
      folderNamingPattern,
      deduplicationEnabled,
      preserveLivePhotos,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-800 text-sky-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">PC Storage & Network Settings</h2>
              <p className="text-xs text-slate-400">External SSD location and Wi-Fi sync preferences</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          
          {/* Target SSD Path */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block flex items-center justify-between">
              <span>External SSD Mount Directory</span>
              <span className="text-slate-500 font-normal text-[11px]">Windows / Mac / Linux path</span>
            </label>
            <input
              type="text"
              value={ssdMountPath}
              onChange={(e) => setSsdMountPath(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-sky-500"
              placeholder="e.g. D:\Photos_SSD_Vault or /Volumes/SSD/Photos"
            />
            <p className="text-[11px] text-slate-500">
              Ensure your external SSD is connected to your PC. Backed-up photos are stored directly in this path.
            </p>
          </div>

          {/* SSD Label */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">External SSD Drive Label</label>
            <input
              type="text"
              value={ssdLabel}
              onChange={(e) => setSsdLabel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-500"
              placeholder="e.g. Samsung T7 Shield 2TB"
            />
          </div>

          {/* Home Wi-Fi SSID */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-sky-400" />
              <span>Authorized Home Wi-Fi Network (SSID)</span>
            </label>
            <input
              type="text"
              value={homeWifiSsid}
              onChange={(e) => setHomeWifiSsid(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-500"
              placeholder="e.g. Home_WiFi_5GHz"
            />
            <p className="text-[11px] text-slate-500">
              Only run automated backups when both iPhones are connected to this local Wi-Fi.
            </p>
          </div>

          {/* Folder Naming Scheme */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">Folder Hierarchy on SSD</label>
            <select
              value={folderNamingPattern}
              onChange={(e) => setFolderNamingPattern(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-500"
            >
              <option value="device_year_month">
                [SSD] / DeviceName / YYYY / MM (Recommended for Dual iPhones)
              </option>
              <option value="year_month">
                [SSD] / YYYY / MM / DeviceName
              </option>
              <option value="flat_timeline">
                [SSD] / DeviceName / All_Photos
              </option>
            </select>
          </div>

          {/* Feature toggles */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3 pt-3">
            
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deduplicationEnabled}
                onChange={(e) => setDeduplicationEnabled(e.target.checked)}
                className="mt-0.5 rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
              />
              <div>
                <span className="font-semibold text-white block">SHA-256 Delta Deduplication</span>
                <span className="text-[11px] text-slate-400">
                  Checks each photo's hash before copying. Skips photos already on the SSD, saving space and Wi-Fi time.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-slate-800/60">
              <input
                type="checkbox"
                checked={preserveLivePhotos}
                onChange={(e) => setPreserveLivePhotos(e.target.checked)}
                className="mt-0.5 rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
              />
              <div>
                <span className="font-semibold text-white block">Preserve Apple Live Photos (.MOV pairs)</span>
                <span className="text-[11px] text-slate-400">
                  Backs up both high-res still (.HEIC) and 3-second motion video (.MOV) paired together.
                </span>
              </div>
            </label>

          </div>

          {/* Footer buttons */}
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
              <span>Apply Configuration</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
