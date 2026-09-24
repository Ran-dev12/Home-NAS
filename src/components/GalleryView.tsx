import React, { useState, useMemo } from 'react';
import { 
  Image as ImageIcon, 
  Video, 
  Layers, 
  Search, 
  Filter, 
  Smartphone, 
  Calendar, 
  ExternalLink,
  Sparkles,
  HardDrive
} from 'lucide-react';
import type { PhotoRecord, Device } from '../types';
import { PhotoDetailModal } from './PhotoDetailModal';
import { formatBytes } from '../utils/qr';

interface GalleryViewProps {
  photos: PhotoRecord[];
  devices: Device[];
  onDeletePhoto: (id: string) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  photos,
  devices,
  onDeletePhoto,
}) => {
  const [selectedDeviceFilter, setSelectedDeviceFilter] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);

  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      if (selectedDeviceFilter !== 'all' && p.deviceId !== selectedDeviceFilter) {
        return false;
      }
      if (selectedTypeFilter !== 'all' && p.mediaType !== selectedTypeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = p.originalFilename.toLowerCase().includes(q);
        const matchDevice = p.deviceName.toLowerCase().includes(q);
        const matchCity = p.exif?.location?.city?.toLowerCase().includes(q);
        const matchDate = p.takenAt.toLowerCase().includes(q);
        return matchName || matchDevice || matchCity || matchDate;
      }
      return true;
    });
  }, [photos, selectedDeviceFilter, selectedTypeFilter, searchQuery]);

  return (
    <div className="space-y-4">
      
      {/* Filter & Search Header Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
        
        {/* Left: Device & Media Type Segmented Controls */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Device Tabs */}
          <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setSelectedDeviceFilter('all')}
              className={`px-3 py-1.5 font-medium rounded-lg transition-colors cursor-pointer ${
                selectedDeviceFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Devices ({photos.length})
            </button>
            {devices.map((dev) => (
              <button
                key={dev.id}
                onClick={() => setSelectedDeviceFilter(dev.id)}
                className={`px-3 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                  selectedDeviceFilter === dev.id
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dev.color }} />
                <span>{dev.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/* Media Types Filter */}
          <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setSelectedTypeFilter('all')}
              className={`px-2.5 py-1.5 font-medium rounded-lg transition-colors cursor-pointer ${
                selectedTypeFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Media
            </button>
            <button
              onClick={() => setSelectedTypeFilter('photo')}
              className={`px-2.5 py-1.5 font-medium rounded-lg transition-colors cursor-pointer ${
                selectedTypeFilter === 'photo'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Photos
            </button>
            <button
              onClick={() => setSelectedTypeFilter('video')}
              className={`px-2.5 py-1.5 font-medium rounded-lg transition-colors cursor-pointer ${
                selectedTypeFilter === 'video'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Videos
            </button>
            <button
              onClick={() => setSelectedTypeFilter('live_photo')}
              className={`px-2.5 py-1.5 font-medium rounded-lg transition-colors cursor-pointer ${
                selectedTypeFilter === 'live_photo'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live Photos
            </button>
          </div>

        </div>

        {/* Right: Search Input */}
        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search photos, dates, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>

      </div>

      {/* Photos Grid */}
      {filteredPhotos.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-12 text-center">
          <ImageIcon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No backed-up photos match this filter</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Trigger an automated sync from your iPhone or use "Test Auto Sync" above to backup sample photos to your PC SSD.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filteredPhotos.map((photo) => {
            const dateStr = new Date(photo.takenAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            const device = devices.find((d) => d.id === photo.deviceId);

            return (
              <div
                key={photo.id}
                onClick={() => setActivePhoto(photo)}
                className="group bg-slate-900 rounded-xl border border-slate-800 overflow-hidden hover:border-sky-500/60 hover:shadow-lg transition-all cursor-pointer relative flex flex-col"
              >
                {/* Thumbnail Aspect Box */}
                <div className="aspect-square bg-slate-950 relative overflow-hidden flex items-center justify-center">
                  <img
                    src={`/api/photos/${photo.id}/file`}
                    alt={photo.originalFilename}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />

                  {/* Device Indicator Pin */}
                  <span
                    className="absolute top-2 left-2 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 shadow"
                    style={{ backgroundColor: device?.color || '#0284c7' }}
                    title={`From: ${photo.deviceName}`}
                  />

                  {/* Media Type Overlay */}
                  {photo.mediaType === 'video' && (
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/70 backdrop-blur rounded text-[10px] font-semibold text-white flex items-center gap-1">
                      <Video className="w-2.5 h-2.5 text-amber-400" />
                      MOV
                    </span>
                  )}
                  {photo.mediaType === 'live_photo' && (
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/70 backdrop-blur rounded text-[10px] font-semibold text-white flex items-center gap-1">
                      <Layers className="w-2.5 h-2.5 text-sky-400" />
                      LIVE
                    </span>
                  )}

                  <span className="absolute bottom-2 right-2 text-[10px] text-slate-300 bg-black/60 px-1 py-0.5 rounded backdrop-blur">
                    {formatBytes(photo.fileSize, 0)}
                  </span>
                </div>

                {/* Quiet Meta Info (No pills) */}
                <div className="p-2 bg-slate-900 text-[11px] truncate">
                  <div className="text-slate-200 font-medium truncate" title={photo.originalFilename}>
                    {photo.originalFilename}
                  </div>
                  <div className="text-slate-500 text-[10px] flex items-center gap-1 mt-0.5">
                    <span>{dateStr}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{photo.deviceName.split(' ')[0]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Photo Detail Modal */}
      {activePhoto && (
        <PhotoDetailModal
          photo={activePhoto}
          onClose={() => setActivePhoto(null)}
          onDelete={(id) => {
            onDeletePhoto(id);
            setActivePhoto(null);
          }}
        />
      )}

    </div>
  );
};
