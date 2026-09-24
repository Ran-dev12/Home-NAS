import React from 'react';
import { Terminal, CheckCircle2, AlertCircle, Info, Clock, RotateCw, Trash2 } from 'lucide-react';
import type { SyncLogEvent } from '../types';
import { formatBytes, formatDate } from '../utils/qr';

interface SyncLogsViewProps {
  logs: SyncLogEvent[];
  isConnectedSse: boolean;
  onClearLogs?: () => void;
}

export const SyncLogsView: React.FC<SyncLogsViewProps> = ({
  logs,
  isConnectedSse,
  onClearLogs,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-800 text-sky-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Live Backup Activity & Diagnostics</h3>
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Wi-Fi Listener
              </span>
            </div>
            <p className="text-xs text-slate-400">Real-time incoming upload stream from both iPhones</p>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          {logs.length} logged sessions
        </div>
      </div>

      {/* Log list */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No recent backup events. Trigger an automated sync to view activity.
          </div>
        ) : (
          logs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div
                key={log.id}
                className="bg-slate-950/70 border border-slate-800/70 rounded-xl p-3 text-xs flex items-start gap-3 hover:border-slate-700 transition-colors"
              >
                {/* Icon based on level */}
                <div className="mt-0.5 shrink-0">
                  {log.level === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {log.level === 'info' && <Info className="w-4 h-4 text-sky-400" />}
                  {log.level === 'warning' && <AlertCircle className="w-4 h-4 text-amber-400" />}
                  {log.level === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-semibold text-slate-200 truncate">
                      {log.deviceName}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {timeStr}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed break-words">
                    {log.message}
                  </p>

                  {/* Transfer stats if available */}
                  {(log.itemsProcessed !== undefined && log.itemsProcessed > 0) && (
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 font-mono">
                      <span>Transferred: {log.itemsProcessed} items</span>
                      {log.bytesTransferred ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(log.bytesTransferred)}</span>
                        </>
                      ) : null}
                      {log.durationMs ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-400">Trigger: {log.trigger}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
