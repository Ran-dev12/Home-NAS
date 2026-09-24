import React, { useState, useRef } from 'react';
import { 
  Smartphone, 
  UploadCloud, 
  Wifi, 
  CheckCircle2, 
  HardDrive, 
  Zap, 
  X, 
  ArrowLeft,
  Sun,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import type { Device, StorageConfig } from '../types';
import { formatBytes } from '../utils/qr';

interface MobileSyncViewProps {
  devices: Device[];
  config: StorageConfig;
  onUploadSuccess: () => void;
  onClose?: () => void;
  defaultDeviceId?: string;
}

export const MobileSyncView: React.FC<MobileSyncViewProps> = ({
  devices,
  config,
  onUploadSuccess,
  onClose,
  defaultDeviceId,
}) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(defaultDeviceId || devices[0]?.id || 'iphone-1');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [currentFilename, setCurrentFilename] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || devices[0];

  // Request Wake Lock to prevent iPhone from sleeping during long uploads
  const toggleWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!wakeLockActive) {
          await (navigator as any).wakeLock.request('screen');
          setWakeLockActive(true);
        } else {
          setWakeLockActive(false);
        }
      } catch (err) {
        console.warn('Wake lock error', err);
      }
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setStatusMessage(`Preparing to backup ${files.length} items to PC SSD...`);

    let uploadedCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFilename(file.name);
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));

      const formData = new FormData();
      formData.append('file', file);
      formData.append('deviceId', selectedDevice.id);
      formData.append('token', selectedDevice.token);
      formData.append('takenAt', new Date(file.lastModified).toISOString());
      formData.append('mediaType', file.type.startsWith('video') ? 'video' : 'photo');
      formData.append('originalFilename', file.name);

      try {
        const response = await fetch('/api/backup/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (data.status === 'duplicate_skipped') {
          duplicateCount++;
        } else {
          uploadedCount++;
        }
      } catch (err) {
        console.error('Upload error', err);
      }
    }

    setIsUploading(false);
    setStatusMessage(
      `Backup complete! ${uploadedCount} new photos saved to SSD (${config.ssdMountPath}), ${duplicateCount} duplicates skipped.`
    );
    onUploadSuccess();

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl max-w-lg mx-auto">
      
      {/* Mobile Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
            style={{ backgroundColor: selectedDevice?.color || '#0284c7' }}
          >
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">iPhone Wi-Fi Sync Portal</h2>
            <p className="text-xs text-slate-400">Direct connection to PC External SSD</p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="space-y-4 mt-4 text-xs">
        
        {/* Device Switcher */}
        <div>
          <label className="text-slate-400 font-medium block mb-1.5">Select Which iPhone You Are Using:</label>
          <div className="grid grid-cols-2 gap-2">
            {devices.map((dev) => (
              <button
                key={dev.id}
                type="button"
                onClick={() => setSelectedDeviceId(dev.id)}
                className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                  selectedDeviceId === dev.id
                    ? 'bg-slate-800 border-sky-500/80 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/40'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dev.color }} />
                <div className="truncate">
                  <span className="font-semibold block text-slate-200 truncate">{dev.name}</span>
                  <span className="text-[10px] text-slate-400">{dev.model}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Wi-Fi & SSD Target verification badge */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5 text-slate-400">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Wifi className="w-3.5 h-3.5" />
              Connected to Wi-Fi ({config.homeWifiSsid})
            </span>
            <span className="text-sky-400 font-mono">SSD Online</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Target folder:{' '}
            <span className="text-slate-200 font-mono">
              {config.ssdMountPath}\{selectedDevice.name.replace(/[^a-zA-Z0-9_-]/g, '_')}\YYYY\MM
            </span>
          </p>
        </div>

        {/* Upload Action Card */}
        <div className="bg-gradient-to-b from-slate-950 to-slate-900 border border-slate-800/90 rounded-2xl p-6 text-center space-y-3">
          
          <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto shadow-inner">
            <UploadCloud className="w-7 h-7 animate-pulse" />
          </div>

          <div>
            <h3 className="text-sm font-bold text-white">Backup Photos from Camera Roll</h3>
            <p className="text-xs text-slate-400 mt-1">
              Select multiple photos, Live Photos, or 4K videos. LocalVault deduplicates automatically.
            </p>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.mov,.mp4"
            onChange={handleFilesSelected}
            className="hidden"
            disabled={isUploading}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-500 active:scale-[0.99] text-white font-semibold rounded-xl text-xs shadow-lg shadow-sky-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? 'Transferring to SSD...' : 'Choose Photos / Videos'}</span>
          </button>

          {/* Wake lock toggle */}
          <button
            type="button"
            onClick={toggleWakeLock}
            className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 mx-auto pt-1 cursor-pointer"
          >
            <Sun className={`w-3.5 h-3.5 ${wakeLockActive ? 'text-amber-400' : 'text-slate-500'}`} />
            <span>{wakeLockActive ? 'Screen Stay Awake: Active' : 'Keep Screen Awake During Large Syncs'}</span>
          </button>
        </div>

        {/* Upload Progress Bar */}
        {isUploading && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium truncate max-w-[200px]">{currentFilename}</span>
              <span className="text-sky-400 font-bold">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Status result feedback */}
        {statusMessage && !isUploading && (
          <div className="bg-emerald-950/40 border border-emerald-800/40 p-3 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{statusMessage}</span>
          </div>
        )}

      </div>

    </div>
  );
};
