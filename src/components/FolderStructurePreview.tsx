import React, { useState } from 'react';
import { 
  X, 
  HardDrive, 
  Folder, 
  FolderOpen, 
  File, 
  Copy, 
  Check, 
  Cpu, 
  Zap, 
  ChevronRight, 
  ChevronDown,
  Info
} from 'lucide-react';
import type { StorageConfig, Device, PhotoRecord } from '../types';
import { formatBytes } from '../utils/qr';

interface FolderStructurePreviewProps {
  config: StorageConfig;
  devices: Device[];
  photos: PhotoRecord[];
  onClose: () => void;
}

export const FolderStructurePreview: React.FC<FolderStructurePreviewProps> = ({
  config,
  devices,
  photos,
  onClose,
}) => {
  const [copiedPath, setCopiedPath] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    root: true,
    'dev-1': true,
    'dev-2': true,
    '2026-1': true,
    '2026-2': true,
  });

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(config.ssdMountPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-800 text-sky-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">External PC SSD Folder Architecture</h2>
              <p className="text-xs text-slate-400">Organized structure directly on your external drive</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comparison banner: PC vs Raspberry Pi */}
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-gradient-to-r from-sky-950/40 to-indigo-950/40 border border-sky-800/40 rounded-xl p-3.5 flex items-start gap-3">
            <Zap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-slate-300 leading-relaxed">
              <strong className="text-white">Why PC + SSD is faster than a Raspberry Pi:</strong>
              <p className="mt-1 text-slate-400">
                A Raspberry Pi shares its internal bus between USB 3.0 and Gigabit Ethernet, causing bottlenecks with dual 4K video uploads. Connected to your PC, your external SSD utilizes full PCIe / USB 3.2 Gen 2 transfer rates (up to 1,050 MB/s), meaning your iPhones finish backups in seconds.
              </p>
            </div>
          </div>

          {/* Root path bar */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-xs text-slate-300 truncate">
              <HardDrive className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-slate-400">SSD Root:</span>
              <span className="text-white font-semibold truncate">{config.ssdMountPath}</span>
            </div>
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium px-2 py-1 rounded bg-slate-900 border border-slate-800 transition-colors"
            >
              {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedPath ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {/* Interactive Visual Directory Tree */}
          <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs text-slate-300 space-y-1.5 overflow-x-auto">
            
            {/* Root item */}
            <div className="flex items-center gap-2 text-white font-semibold">
              <HardDrive className="w-4 h-4 text-sky-400" />
              <span>{config.ssdMountPath} ({config.ssdLabel})</span>
            </div>

            {/* Device 1 Subtree */}
            {devices.map((device, idx) => {
              const devKey = `dev-${idx}`;
              const isExpanded = expandedFolders[devKey] ?? true;
              const devPhotos = photos.filter((p) => p.deviceId === device.id);
              const folderName = device.name.replace(/[^a-zA-Z0-9_-]/g, '_');

              return (
                <div key={device.id} className="pl-4 border-l border-slate-800/80 mt-1 space-y-1">
                  
                  {/* Device Folder */}
                  <div 
                    onClick={() => toggleFolder(devKey)}
                    className="flex items-center gap-1.5 text-slate-200 hover:text-white cursor-pointer py-0.5"
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                    <Folder className="w-4 h-4 text-amber-400" />
                    <span className="font-semibold text-sky-300">{folderName}</span>
                    <span className="text-[10px] text-slate-500 font-sans">
                      ({device.totalPhotosSynced} photos · {formatBytes(device.totalBytesSynced)})
                    </span>
                  </div>

                  {/* Year Subfolder */}
                  {isExpanded && (
                    <div className="pl-6 border-l border-slate-800/80 space-y-1">
                      
                      <div className="flex items-center gap-1.5 text-slate-300 py-0.5">
                        <Folder className="w-3.5 h-3.5 text-amber-400/80" />
                        <span className="text-amber-200">2026/</span>
                      </div>

                      {/* Month subfolder */}
                      <div className="pl-5 border-l border-slate-800/80 space-y-1">
                        <div className="flex items-center gap-1.5 text-slate-300 py-0.5">
                          <Folder className="w-3.5 h-3.5 text-amber-400/80" />
                          <span className="text-amber-200">09-September/</span>
                          <span className="text-[10px] text-slate-500 font-sans">(Active sync month)</span>
                        </div>

                        {/* Sample files inside */}
                        <div className="pl-5 border-l border-slate-800/80 space-y-1 text-slate-400 text-[11px]">
                          {devPhotos.slice(0, 3).map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 hover:text-slate-200 truncate">
                              <File className="w-3 h-3 text-slate-500 shrink-0" />
                              <span className="text-slate-300 truncate">{p.filename}</span>
                              <span className="text-[10px] text-slate-600 font-sans">({formatBytes(p.fileSize, 1)})</span>
                            </div>
                          ))}
                          {devPhotos.length > 3 && (
                            <div className="text-[10px] text-slate-600 pl-4">
                              + {devPhotos.length - 3} more files in this folder...
                            </div>
                          )}
                        </div>

                      </div>

                    </div>
                  )}

                </div>
              );
            })}

            {/* Manifest / Deduplication index file */}
            <div className="pl-4 border-l border-slate-800/80 pt-1 flex items-center gap-1.5 text-slate-400 text-[11px]">
              <File className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-emerald-300">.localvault_manifest.json</span>
              <span className="text-[10px] text-slate-500 font-sans">(SHA-256 deduplication catalog)</span>
            </div>

          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-400">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              All original EXIF metadata (GPS, aperture, lens, timestamp) and Live Photo .MOV pairs are saved byte-for-byte in their pristine original format.
            </span>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};
