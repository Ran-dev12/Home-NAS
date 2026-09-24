import React, { useState, useEffect } from 'react';
import { 
  X, 
  Smartphone, 
  Wifi, 
  BatteryCharging, 
  Clock, 
  ExternalLink, 
  Copy, 
  Check, 
  Download, 
  Zap, 
  CheckCircle2, 
  HelpCircle,
  QrCode as QrIcon,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import type { Device, StorageConfig } from '../types';
import { generateQrDataUrl } from '../utils/qr';

interface IosShortcutsModalProps {
  device: Device;
  config: StorageConfig;
  networkInfo: {
    primaryIp: string;
    port: number;
    fullUrl: string;
  } | null;
  onClose: () => void;
}

export const IosShortcutsModal: React.FC<IosShortcutsModalProps> = ({
  device,
  config,
  networkInfo,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'qr' | 'blueprint' | 'webhook'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const pcIp = networkInfo?.primaryIp || config.pcLocalIp || '192.168.1.105';
  const port = networkInfo?.port || config.serverPort || 3000;
  // If running locally, use LAN IP; if running on remote URL, fallback to current origin for web test
  const isCloudHost = window.location.hostname.includes('run.app') || window.location.hostname.includes('google');
  const lanBaseUrl = `http://${pcIp}:${port}`;
  const effectiveBaseUrl = isCloudHost ? window.location.origin : lanBaseUrl;
  const uploadEndpoint = `${effectiveBaseUrl}/api/backup/upload`;
  const mobilePairUrl = `${effectiveBaseUrl}?mobile=true&device=${device.id}&token=${device.token}`;

  useEffect(() => {
    generateQrDataUrl(mobilePairUrl).then((url) => setQrDataUrl(url));
  }, [mobilePairUrl]);

  const handleCopyEndpoint = () => {
    navigator.clipboard.writeText(uploadEndpoint);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(device.token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const downloadShortcutJson = () => {
    const shortcutTemplate = {
      name: `LocalVault Auto Backup - ${device.name}`,
      version: '2.0',
      description: 'Automated Wi-Fi SSD Photo Backup for iOS Shortcuts',
      config: {
        serverUrl: uploadEndpoint,
        deviceId: device.id,
        deviceName: device.name,
        token: device.token,
        targetWifiSsid: device.syncSchedule.wifiSsid || config.homeWifiSsid,
        triggerType: device.syncSchedule.triggerType,
      },
      instructions: [
        'Open Apple Shortcuts app on iPhone',
        'Tap "Automation" tab at bottom',
        'Create Personal Automation with Trigger: Connected to Wi-Fi or Charger',
        'Add Action: Find Photos -> Date Taken is in last 24h',
        'Add Action: Get Contents of URL (POST to serverUrl)',
      ],
    };

    const blob = new Blob([JSON.stringify(shortcutTemplate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LocalVault_${device.name.replace(/\s+/g, '_')}_Shortcut.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
              style={{ backgroundColor: device.color }}
            >
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Automatic Wi-Fi Sync for {device.name}
              </h2>
              <p className="text-xs text-slate-400">
                Direct transfer to PC SSD at <span className="font-mono text-slate-300">{config.ssdMountPath}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-900/50">
          <button
            onClick={() => setActiveTab('qr')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'qr'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrIcon className="w-4 h-4" />
            <span>1. Scan QR with iPhone</span>
          </button>
          <button
            onClick={() => setActiveTab('blueprint')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'blueprint'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>2. iOS Automation Blueprint</span>
          </button>
          <button
            onClick={() => setActiveTab('webhook')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'webhook'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wifi className="w-4 h-4" />
            <span>3. Direct Webhook & Endpoints</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6">
          
          {/* TAB 1: QR PAIRING & SHORTCUT QUICK LAUNCH */}
          {activeTab === 'qr' && (
            <div className="space-y-5">
              <div className="bg-sky-950/40 border border-sky-800/40 rounded-xl p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 leading-relaxed">
                  <span className="font-semibold text-white">How automatic background backup works on iPhone:</span>
                  <p className="mt-1">
                    Point your iPhone’s camera at the QR code below. It links directly to this PC over your home Wi-Fi network. From there, you can install the 1-click iOS Shortcut and bookmark the instant delta sync companion!
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6 bg-slate-950 p-5 rounded-2xl border border-slate-800">
                {/* QR Code Canvas */}
                <div className="bg-white p-3 rounded-xl shadow-lg shrink-0">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Pair iPhone QR" className="w-44 h-44 rounded" />
                  ) : (
                    <div className="w-44 h-44 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                      Generating QR...
                    </div>
                  )}
                  <p className="text-[10px] text-slate-600 text-center font-mono mt-1">Scan with iPhone Camera</p>
                </div>

                {/* Instructions alongside QR */}
                <div className="space-y-3 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">1</span>
                    <p className="text-slate-300">
                      Ensure your iPhone is connected to <span className="text-white font-medium underline decoration-sky-500">{config.homeWifiSsid}</span>
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">2</span>
                    <p className="text-slate-300">
                      Open Camera on <span className="font-medium text-white">{device.name}</span> and tap the yellow link prompt.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center font-bold text-[11px] shrink-0">3</span>
                    <p className="text-slate-300">
                      Tap <span className="text-emerald-400 font-semibold">"Install Background Automation"</span> or perform one-tap initial backup!
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-2">
                    <button
                      onClick={downloadShortcutJson}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      <span>Download Shortcut Recipe (.json)</span>
                    </button>
                    <a
                      href={mobilePairUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600/80 hover:bg-sky-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Web Companion</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: IOS AUTOMATION BLUEPRINT */}
          {activeTab === 'blueprint' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-300">
                To run silent, 100% automated periodic backups without touching your phone, set up a native{' '}
                <strong className="text-white">Personal Automation</strong> in Apple's built-in <strong className="text-white">Shortcuts</strong> app:
              </div>

              {/* Step cards */}
              <div className="space-y-3">
                
                {/* Step 1 */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-white mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[11px]">1</span>
                      Choose Your Automatic Trigger
                    </span>
                    <span className="text-[11px] text-emerald-400 font-normal">Native iOS Trigger</span>
                  </div>
                  <p className="text-xs text-slate-400 pl-7">
                    Open <strong className="text-slate-200">Shortcuts</strong> → Tap <strong className="text-slate-200">Automation</strong> (center tab at bottom) → Tap <strong className="text-slate-200">New Automation (+)</strong>.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pl-7 text-xs">
                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                      <span className="font-semibold text-amber-400 flex items-center gap-1">
                        <BatteryCharging className="w-3.5 h-3.5" />
                        Option A: While Charging (Recommended)
                      </span>
                      <p className="text-slate-400 text-[11px] mt-1">
                        Trigger: "When iPhone is connected to power". Set "Run Immediately" without asking. Runs every night!
                      </p>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                      <span className="font-semibold text-sky-400 flex items-center gap-1">
                        <Wifi className="w-3.5 h-3.5" />
                        Option B: When Joining Home Wi-Fi
                      </span>
                      <p className="text-slate-400 text-[11px] mt-1">
                        Trigger: "When Wi-Fi joins {config.homeWifiSsid}". Automatically uploads all new photos the moment you walk in!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-white mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[11px]">2</span>
                      Add Action: "Find Photos"
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 pl-7 space-y-1">
                    <p>Add action: <strong className="text-slate-200">Find Photos</strong>.</p>
                    <p>Filter: <code className="text-sky-300 bg-slate-900 px-1 py-0.5 rounded">Date Taken is in the last 24 hours</code> (or after last backup date).</p>
                    <p>Limit: Unchecked (grabs all new photos & videos).</p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-white mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-[11px]">3</span>
                      Add Action: "Get Contents of URL" (Send to PC SSD)
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 pl-7 space-y-2">
                    <p>Add action: <strong className="text-slate-200">Get Contents of URL</strong>.</p>
                    <div className="bg-slate-900 p-2 rounded-lg font-mono text-[11px] text-slate-300 space-y-1">
                      <div>URL: <span className="text-emerald-400">{uploadEndpoint}</span></div>
                      <div>Method: <span className="text-sky-400">POST</span></div>
                      <div>Request Body: <span className="text-amber-400">Form</span></div>
                      <div className="pl-4 text-slate-400">
                        • <span className="text-slate-200">file</span> = [Photos] (File)<br />
                        • <span className="text-slate-200">deviceId</span> = {device.id}<br />
                        • <span className="text-slate-200">token</span> = {device.token}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* TAB 3: DIRECT WEBHOOK & ENDPOINTS */}
          {activeTab === 'webhook' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-300">
                Raw HTTP API specifications for integrating custom scripts, Python syncers, or advanced Shortcuts:
              </div>

              <div className="space-y-3 text-xs">
                
                {/* Upload URL */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-400 font-medium">Photo & Video Upload POST Endpoint:</span>
                    <button
                      onClick={handleCopyEndpoint}
                      className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                    >
                      {copiedEndpoint ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedEndpoint ? 'Copied' : 'Copy URL'}</span>
                    </button>
                  </div>
                  <div className="bg-slate-900 p-2 rounded font-mono text-emerald-300 text-[11px] break-all border border-slate-800">
                    {uploadEndpoint}
                  </div>
                </div>

                {/* Device Token */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-400 font-medium">Device Token ({device.name}):</span>
                    <button
                      onClick={handleCopyToken}
                      className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                    >
                      {copiedToken ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedToken ? 'Copied' : 'Copy Token'}</span>
                    </button>
                  </div>
                  <div className="bg-slate-900 p-2 rounded font-mono text-slate-300 text-[11px] border border-slate-800">
                    {device.token}
                  </div>
                </div>

                {/* Deduplication check endpoint */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 font-medium block mb-1">Delta / Hash Deduplication Check:</span>
                  <div className="bg-slate-900 p-2 rounded font-mono text-[11px] text-slate-300 border border-slate-800">
                    POST {lanBaseUrl}/api/backup/check<br />
                    <span className="text-slate-500">Body: {`{ "hashes": ["sha256_hash1", "sha256_hash2"] }`}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Allows the iPhone or syncer to query which photos are already stored on the SSD, preventing redundant Wi-Fi bandwidth and disk writes.
                  </p>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            PC SSD Target: <span className="text-slate-200 font-mono">{config.ssdMountPath}</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
