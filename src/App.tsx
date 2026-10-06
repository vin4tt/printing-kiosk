import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Smartphone,
  Shield,
  Printer,
  Sparkles,
  Layers,
  Globe,
  Radio,
  FileCheck,
  Wifi,
} from 'lucide-react';
import { KioskTerminal } from './components/KioskTerminal.tsx';
import { MobileCustomerFlow } from './components/MobileCustomerFlow.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { KioskData, Language, PrintJobData } from './types/kiosk.ts';

export default function App() {
  const [activeView, setActiveView] = useState<'KIOSK' | 'MOBILE' | 'ADMIN'>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes('mobile')) return 'MOBILE';
      if (hash.includes('admin')) return 'ADMIN';
      const search = window.location.search.toLowerCase();
      if (search.includes('mobile')) return 'MOBILE';
      if (search.includes('admin')) return 'ADMIN';
    }
    return 'KIOSK';
  });
  const [language, setLanguage] = useState<Language>('en');

  // Active kiosk data
  const [kiosk, setKiosk] = useState<KioskData | null>({
    id: 'KSK-001',
    name: 'Main Campus Terminal A',
    location: 'Central Library, Ground Floor',
    status: 'ONLINE',
    printerName: 'HP LaserJet Enterprise M608',
    printerStatus: 'READY',
    currentJobId: null,
    lastHeartbeat: new Date().toISOString(),
    softwareVersion: 'v1.5.0',
    isAcceptingJobs: true,
  });

  // Currently tracking print job and OTP code
  const [activeJob, setActiveJob] = useState<PrintJobData | null>(null);
  const [currentOtp, setCurrentOtp] = useState<string>('');

  // Real-time synchronization states between Phone and Kiosk
  const [mobileConnected, setMobileConnected] = useState<{
    customerName: string;
    customerPhone: string;
    sessionId: string;
  } | null>(null);

  const [mobileProgress, setMobileProgress] = useState<{
    step: string;
    details?: any;
  } | null>(null);

  const [printProgress, setPrintProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 1, total: 1 });

  // Fetch initial kiosk status
  const fetchKioskStatus = async () => {
    try {
      const res = await fetch('/api/kiosks/KSK-001');
      if (res.ok) {
        const data = await res.json();
        setKiosk(data);
      }
    } catch (e) {
      // Keep state
    }
  };

  useEffect(() => {
    fetchKioskStatus();

    const handleHashChange = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes('mobile')) setActiveView('MOBILE');
      else if (hash.includes('admin')) setActiveView('ADMIN');
      else if (hash.includes('kiosk')) setActiveView('KIOSK');
    };
    window.addEventListener('hashchange', handleHashChange);

    // Listen to real-time events via Server-Sent Events (SSE)
    const eventSource = new EventSource('/api/stream');

    eventSource.addEventListener('MOBILE_CONNECTED', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMobileConnected({
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          sessionId: data.sessionId,
        });
      } catch (err) {}
    });

    eventSource.addEventListener('MOBILE_PROGRESS', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMobileProgress({
          step: data.step,
          details: data.details,
        });
      } catch (err) {}
    });

    eventSource.addEventListener('OTP_VERIFIED', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.job) {
          setActiveJob(data.job);
        }
      } catch (err) {}
    });

    eventSource.addEventListener('PAYMENT_CONFIRMED', (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveJob((prev) =>
          prev && prev.id === data.jobId ? { ...prev, paymentStatus: 'PAID', status: 'PAID' } : prev
        );
      } catch (err) {}
    });

    eventSource.addEventListener('JOB_STATUS_CHANGE', (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveJob((prev) => (prev && prev.id === data.jobId ? { ...prev, status: data.status } : prev));
      } catch (err) {}
    });

    eventSource.addEventListener('JOB_PROGRESS', (e) => {
      try {
        const data = JSON.parse(e.data);
        setPrintProgress({
          current: data.currentPage,
          total: data.totalPages,
        });
      } catch (err) {}
    });

    eventSource.addEventListener('PRINTER_STATUS_CHANGE', (e) => {
      try {
        const data = JSON.parse(e.data);
        setKiosk((prev) => (prev ? { ...prev, printerStatus: data.status } : null));
      } catch (err) {}
    });

    eventSource.addEventListener('JOB_CANCELLED', (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveJob((prev) => (prev && prev.id === data.jobId ? { ...prev, status: 'CANCELLED' } : prev));
      } catch (err) {}
    });

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      eventSource.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* SYSTEM NAVIGATION BAR (Switching between Touchless Kiosk, Customer Phone & Operator Desk) */}
      <nav className="bg-slate-900/90 border-b border-slate-800 px-6 py-3 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Logo & Product Tagline */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-600/30">
              <Printer className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-tight text-white">SMART PRINT KIOSK</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <Wifi className="w-2.5 h-2.5" />
                  TOUCHLESS SYSTEM LIVE
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Scan. Configure on Phone. Pay. Print.</span>
            </div>
          </div>

          {/* View Switcher Tabs */}
          <div className="flex items-center bg-slate-950 p-1 rounded-2xl border border-slate-800 shadow-inner">
            <button
              onClick={() => setActiveView('KIOSK')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                activeView === 'KIOSK'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Physical Kiosk Screen</span>
              {mobileConnected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Phone connected" />
              )}
            </button>

            <button
              onClick={() => setActiveView('MOBILE')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                activeView === 'MOBILE'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Customer Smartphone</span>
              {activeJob && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </button>

            <button
              onClick={() => setActiveView('ADMIN')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                activeView === 'ADMIN'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Operator & Admin Desk</span>
            </button>
          </div>

          {/* Quick Multilingual Toggle */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              aria-label="Language Selector"
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none"
            >
              <option value="en">English</option>
              <option value="mr">मराठी (Marathi)</option>
              <option value="hi">हिंदी (Hindi)</option>
              <option value="gu">ગુજરાતી (Gujarati)</option>
              <option value="ta">தமிழ் (Tamil)</option>
              <option value="kn">ಕನ್ನಡ (Kannada)</option>
              <option value="es">Español (Spanish)</option>
            </select>
          </div>
        </div>
      </nav>

      {/* VIEWPORT CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
        {/* VIEW 1: PHYSICAL KIOSK TERMINAL (Zero Touch) */}
        {activeView === 'KIOSK' && (
          <div className="animate-in fade-in duration-300">
            <KioskTerminal
              kiosk={kiosk}
              language={language}
              onLanguageChange={setLanguage}
              activeJob={activeJob}
              onJobUpdated={(job) => setActiveJob(job)}
              onSwitchToMobile={() => setActiveView('MOBILE')}
              mobileConnected={mobileConnected}
              mobileProgress={mobileProgress}
              printProgress={printProgress}
            />
          </div>
        )}

        {/* VIEW 2: CUSTOMER SMARTPHONE FLOW (Full remote control) */}
        {activeView === 'MOBILE' && (
          <div className="py-4 animate-in fade-in duration-300">
            <MobileCustomerFlow
              kioskId={kiosk?.id || 'KSK-001'}
              language={language}
              onJobSubmitted={(job, otp) => {
                setActiveJob(job);
                setCurrentOtp(otp);
              }}
              activeJob={activeJob}
              otpCode={currentOtp}
              printerStatus={kiosk?.printerStatus}
              onJobUpdated={(job) => setActiveJob(job)}
            />
          </div>
        )}

        {/* VIEW 3: ADMIN & OPERATOR CONSOLE */}
        {activeView === 'ADMIN' && (
          <div className="animate-in fade-in duration-300">
            <AdminDashboard onRefreshKiosk={fetchKioskStatus} />
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="py-4 px-6 border-t border-slate-900 bg-slate-950 text-center text-xs text-slate-500">
        <p>Smart Print Kiosk — Production Self-Service Terminal • Touchless Phone Integration • Windows Print Spooler</p>
      </footer>
    </div>
  );
}
