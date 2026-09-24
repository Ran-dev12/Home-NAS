import React, { useState } from 'react';
import { 
  Monitor, 
  Terminal, 
  Download, 
  Check, 
  Copy, 
  HardDrive, 
  Wifi, 
  Smartphone, 
  FolderCheck, 
  ShieldCheck, 
  Play, 
  ExternalLink,
  ChevronRight,
  HelpCircle,
  FileCode
} from 'lucide-react';
import type { StorageConfig } from '../types';

interface PcSetupGuideProps {
  config: StorageConfig;
  onOpenSettings: () => void;
}

export const PcSetupGuide: React.FC<PcSetupGuideProps> = ({ config, onOpenSettings }) => {
  const [selectedMethod, setSelectedMethod] = useState<'node' | 'python' | 'native_app'>('node');
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedScript(id);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  const nodeScript = `# 1. Create a folder on your PC and enter it:
mkdir LocalVault-SSD
cd LocalVault-SSD

# 2. Download the ready-to-run PC server script:
curl -O ${window.location.origin}/localvault-pc-server.js

# 3. Install the 2 lightweight dependencies:
npm install express multer

# 4. Set your SSD drive letter (Windows: D:, E: etc.) and run:
# Windows PowerShell:
$env:SSD_PATH = "D:\\iPhone_Photos_SSD"; node localvault-pc-server.js

# Mac / Linux:
SSD_PATH="/Volumes/My_SSD/iPhone_Photos" node localvault-pc-server.js`;

  const pythonScript = `# 1. Create a folder on your PC:
mkdir LocalVault-SSD
cd LocalVault-SSD

# 2. Download the Python PC server script:
curl -O ${window.location.origin}/localvault-pc-server.py

# 3. Install Flask:
pip install flask

# 4. Run the server:
python localvault-pc-server.py`;

  return (
    <div className="space-y-6">
      
      {/* Top Banner explaining PC vs Pi */}
      <div className="bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-800/60 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs font-semibold">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Direct PC + External SSD Setup (No Raspberry Pi Required)</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Turn Your Existing PC & SSD into a High-Speed Wi-Fi Backup Hub
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Most guides online recommend buying a Raspberry Pi, but your PC is vastly superior: it delivers <strong className="text-white">full USB 3.2 NVMe bus speeds (1,050 MB/s)</strong> directly to your external SSD without power throttling or Pi hardware purchases.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/localvault-pc-server.js"
              download="localvault-pc-server.js"
              className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-600/30 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download PC Server (.js)</span>
            </a>
          </div>
        </div>
      </div>

      {/* 3 Step Interactive Setup Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Step 1: Connect SSD */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-xl bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center text-xs">
              1
            </span>
            <h3 className="text-sm font-bold text-white">Plug SSD into your PC</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Plug your Samsung, SanDisk, or Crucial external SSD into a USB 3.0 or USB-C port on your PC.
          </p>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-500 block">Current Configured Target:</span>
            <span className="font-mono text-xs text-sky-300 font-semibold break-all">
              {config.ssdMountPath}
            </span>
            <button
              onClick={onOpenSettings}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline block pt-1 cursor-pointer"
            >
              Change drive letter or path
            </button>
          </div>
        </div>

        {/* Step 2: Run Server */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-xs">
              2
            </span>
            <h3 className="text-sm font-bold text-white">Run Server on PC</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Run the 1-file standalone server on your PC in background. It listens on port 3000 on your home Wi-Fi.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMethod('node')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                selectedMethod === 'node'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-950 text-slate-400 border border-slate-800'
              }`}
            >
              Node.js
            </button>
            <button
              onClick={() => setSelectedMethod('python')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                selectedMethod === 'python'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-950 text-slate-400 border border-slate-800'
              }`}
            >
              Python
            </button>
          </div>
        </div>

        {/* Step 3: Automate on 2 iPhones */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs">
              3
            </span>
            <h3 className="text-sm font-bold text-white">Automate on both iPhones</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Set Apple's built-in <strong className="text-slate-200">Shortcuts</strong> automation to back up every night when connected to charger and Wi-Fi.
          </p>
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
            <div className="flex items-center gap-1 text-emerald-400 font-semibold">
              <Check className="w-3.5 h-3.5" />
              <span>iPhone 1: Ranjeet Pro (Bedside Auto)</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-400 font-semibold">
              <Check className="w-3.5 h-3.5" />
              <span>iPhone 2: Family iPhone (Home Wi-Fi Auto)</span>
            </div>
          </div>
        </div>

      </div>

      {/* Code / Command Terminal */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
            <Terminal className="w-4 h-4 text-sky-400" />
            <span>
              {selectedMethod === 'node' ? 'Terminal commands (Windows CMD / PowerShell / Mac Terminal)' : 'Python commands'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(selectedMethod === 'node' ? nodeScript : pythonScript, selectedMethod)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              {copiedScript === selectedMethod ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Commands</span>
                </>
              )}
            </button>
            <a
              href={selectedMethod === 'node' ? '/localvault-pc-server.js' : '/localvault-pc-server.py'}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </a>
          </div>
        </div>

        <div className="p-5 bg-slate-950 font-mono text-xs text-sky-200 overflow-x-auto leading-relaxed">
          <pre className="whitespace-pre">
            {selectedMethod === 'node' ? nodeScript : pythonScript}
          </pre>
        </div>

        <div className="px-5 py-3 bg-slate-900/60 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Zero cloud dependency. All photos go straight over your home Wi-Fi into your PC SSD.</span>
          </div>
          <span className="font-mono text-slate-300">
            Port: {config.serverPort || 3000} · Wi-Fi: {config.homeWifiSsid}
          </span>
        </div>

      </div>

      {/* Comparison: Why you do not need a Raspberry Pi */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-sky-400" />
          <span>Why your PC + SSD setup is significantly better than a Raspberry Pi</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800/80 space-y-2">
            <span className="font-bold text-emerald-400 block text-sm">✓ Your Setup: External SSD on PC</span>
            <ul className="space-y-1.5 text-slate-300">
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">1.</span>
                <span><strong>No extra hardware costs:</strong> You already have the PC and the external SSD.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">2.</span>
                <span><strong>Fastest USB 3.2 NVMe bus:</strong> Up to 1,050 MB/s transfer speed for 4K video clips.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">3.</span>
                <span><strong>Stable Power Supply:</strong> External SSDs require high continuous power that often throttles or crashes a Raspberry Pi.</span>
              </li>
            </ul>
          </div>

          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800/80 space-y-2 opacity-75">
            <span className="font-bold text-rose-400 block text-sm">✗ Common Raspberry Pi Problems</span>
            <ul className="space-y-1.5 text-slate-400">
              <li className="flex items-start gap-1.5">
                <span className="text-rose-400 font-bold">1.</span>
                <span>Costs $80 - $120+ for the board, power adapter, case, and cooling.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-rose-400 font-bold">2.</span>
                <span>Under-voltage brownouts when external SSD draws write spikes.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-rose-400 font-bold">3.</span>
                <span>Shared USB & Gigabit bus bottlenecks when 2 phones backup at once.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
};
