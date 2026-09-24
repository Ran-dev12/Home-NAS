import React, { useState } from 'react';
import { 
  X, 
  HardDrive, 
  Calendar, 
  Camera, 
  MapPin, 
  FileText, 
  Copy, 
  Check, 
  Download, 
  Trash2, 
  Smartphone,
  ShieldCheck,
  Maximize2
} from 'lucide-react';
import type { PhotoRecord } from '../types';
import { formatBytes, formatDate } from '../utils/qr';

interface PhotoDetailModalProps {
  photo: PhotoRecord;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const PhotoDetailModal: React.FC<PhotoDetailModalProps> = ({
  photo,
  onClose,
  onDelete,
}) => {
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(photo.absoluteSsdPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(photo.fileHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const fileUrl = `/api/photos/${photo.id}/file`;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col md:flex-row my-6 max-h-[90vh]">
        
        {/* Left Side: Media Preview */}
        <div className="md:w-3/5 bg-black/70 flex items-center justify-center p-4 relative min-h-[300px] md:min-h-[500px]">
          {photo.mediaType === 'video' ? (
            <video 
              src={fileUrl} 
              controls 
              className="max-h-full max-w-full rounded-lg shadow-lg object-contain"
              poster={fileUrl}
            />
          ) : (
            <img
              src={fileUrl}
              alt={photo.originalFilename}
              className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
          )}

          <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-800 text-xs text-slate-300 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: photo.deviceId === 'iphone-1' ? '#0284c7' : '#8b5cf6' }} />
            <span>{photo.deviceName}</span>
          </div>
        </div>

        {/* Right Side: SSD Storage & EXIF Metadata Inspector */}
        <div className="md:w-2/5 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/95 overflow-y-auto">
          
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="truncate pr-2">
              <h3 className="text-base font-bold text-white truncate" title={photo.originalFilename}>
                {photo.originalFilename}
              </h3>
              <p className="text-xs text-slate-400 capitalize">
                {photo.mediaType.replace('_', ' ')} · {formatBytes(photo.fileSize)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details Body */}
          <div className="p-5 space-y-4 text-xs">
            
            {/* SSD Storage Path info */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400 font-medium">
                <span className="flex items-center gap-1.5 text-sky-400">
                  <HardDrive className="w-3.5 h-3.5" />
                  Stored on External SSD
                </span>
                <button
                  onClick={handleCopyPath}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                  title="Copy full path on PC"
                >
                  {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPath ? 'Copied' : 'Copy Path'}</span>
                </button>
              </div>
              <div className="bg-slate-900 p-2 rounded font-mono text-[11px] text-slate-200 break-all border border-slate-800/80">
                {photo.absoluteSsdPath}
              </div>
              <span className="text-[10px] text-slate-500 block">
                Relative: {photo.relativeSsdPath}
              </span>
            </div>

            {/* Date & Timestamps */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-500 block">Date Taken on iPhone</span>
                <span className="text-slate-200 font-medium">
                  {new Date(photo.takenAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-500 block">Synced to PC SSD</span>
                <span className="text-slate-200 font-medium">{formatDate(photo.syncedAt)}</span>
              </div>
            </div>

            {/* Camera & Lens EXIF */}
            {photo.exif && (
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60 space-y-2">
                <span className="text-slate-400 font-medium flex items-center gap-1 text-[11px]">
                  <Camera className="w-3.5 h-3.5 text-indigo-400" />
                  Camera & Exposure EXIF
                </span>
                <div className="grid grid-cols-2 gap-2 text-slate-300 text-[11px]">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Device Model</span>
                    <span>{photo.exif.cameraModel || 'Apple iPhone'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Lens</span>
                    <span>{photo.exif.lens || 'Main Lens'}</span>
                  </div>
                  {photo.exif.dimensions && (
                    <div>
                      <span className="text-slate-500 block text-[10px]">Resolution</span>
                      <span>{photo.exif.dimensions.width} × {photo.exif.dimensions.height}</span>
                    </div>
                  )}
                  {photo.exif.aperture && (
                    <div>
                      <span className="text-slate-500 block text-[10px]">Aperture / ISO</span>
                      <span>{photo.exif.aperture} · ISO {photo.exif.iso}</span>
                    </div>
                  )}
                </div>
                {photo.exif.location?.city && (
                  <div className="pt-2 border-t border-slate-800/60 flex items-center gap-1.5 text-slate-300 text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>{photo.exif.location.city}</span>
                  </div>
                )}
              </div>
            )}

            {/* Deduplication SHA-256 Checksum */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
              <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                <span className="flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Deduplication Checksum (SHA-256)
                </span>
                <button
                  onClick={handleCopyHash}
                  className="hover:text-white"
                  title="Copy SHA-256"
                >
                  {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <div className="font-mono text-[10px] text-slate-400 truncate">
                {photo.fileHash}
              </div>
            </div>

          </div>

          {/* Action Footer */}
          <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2">
            <button
              onClick={() => onDelete(photo.id)}
              className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1.5 rounded hover:bg-rose-950/40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete from SSD</span>
            </button>

            <a
              href={fileUrl}
              download={photo.originalFilename}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Original</span>
            </a>
          </div>

        </div>

      </div>
    </div>
  );
};
