import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  Printer,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Globe,
  FileText,
  Clock,
  ArrowRight,
  Sparkles,
  Check,
  Mic,
  Smartphone,
  QrCode,
  Pause,
  Play,
  XCircle,
  Layers,
  DollarSign,
  Wifi,
  Lock,
} from 'lucide-react';
import { KioskData, Language, PrintJobData } from '../types/kiosk.ts';
import { translations } from '../i18n/translations.ts';
import { GeminiVoiceAssistant } from '../../frontend/components/GeminiVoiceAssistant.tsx';

interface KioskTerminalProps {
  kiosk: KioskData | null;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  activeJob: PrintJobData | null;
  onJobUpdated: (job: PrintJobData) => void;
  onSwitchToMobile: () => void;
  mobileConnected?: { customerName?: string; customerPhone?: string; sessionId?: string } | null;
  mobileProgress?: { step: string; details?: any } | null;
  printProgress?: { current: number; total: number };
}

export const KioskTerminal: React.FC<KioskTerminalProps> = ({
  kiosk,
  language,
  onLanguageChange,
  activeJob,
  onJobUpdated,
  onSwitchToMobile,
  mobileConnected: externalMobileConnected,
  mobileProgress: externalMobileProgress,
  printProgress: externalPrintProgress,
}) => {
  const t = translations[language] || translations.en;

  // Terminal navigation steps
  type Step =
    | 'TOUCHLESS_HOME'
    | 'PHONE_PAIRED'
    | 'UPLOADING_MIRROR'
    | 'PAYMENT_QR'
    | 'PRINTING'
    | 'PAUSED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'ERROR';

  const [currentStep, setCurrentStep] = useState<Step>('TOUCHLESS_HOME');

  // Dynamic QR Codes
  const [sessionQrUrl, setSessionQrUrl] = useState<string>('');
  const [paymentQrUrl, setPaymentQrUrl] = useState<string>('');
  const [mobileDirectUrl, setMobileDirectUrl] = useState<string>('');

  // Paired mobile state
  const [pairedCustomer, setPairedCustomer] = useState<{
    name: string;
    phone: string;
    sessionId: string;
  } | null>(null);

  // Live Mirroring from customer's phone
  const [mirroredUploadProgress, setMirroredUploadProgress] = useState<number>(0);
  const [mirroredDocInfo, setMirroredDocInfo] = useState<{
    fileName: string;
    totalPages: number;
    paperSize: string;
    colorMode: string;
    isDuplex: boolean;
    copies: number;
    totalPrice: number;
  } | null>(null);

  // Modals & Timers
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [showHostModal, setShowHostModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [customHostInput, setCustomHostInput] = useState('');
  const [customHostUrl, setCustomHostUrl] = useState<string>(() => {
    return localStorage.getItem('kiosk_custom_host') || '';
  });
  const [paymentCountdown, setPaymentCountdown] = useState<number>(180); // 3 minutes
  const [sessionAutoCloseSeconds, setSessionAutoCloseSeconds] = useState(15);
  const [qrRefreshCountdown, setQrRefreshCountdown] = useState(300); // 5 mins dynamic QR refresh

  // Printing progress
  const [currentPrintPage, setCurrentPrintPage] = useState(1);
  const [totalPrintPages, setTotalPrintPages] = useState(1);

  const kioskId = kiosk?.id || 'KSK-001';
  const isCloudDev = typeof window !== 'undefined' && window.location.origin.includes('ais-dev-');

  // Fetch host config from server if available
  useEffect(() => {
    fetch('/api/config/kiosk-url')
      .then((res) => res.json())
      .then((data) => {
        if (data.customConfiguredUrl && !customHostUrl) {
          setCustomHostUrl(data.customConfiguredUrl);
        }
      })
      .catch(() => {});
  }, []);

  // 1. Generate Dynamic Session QR code for touchless customer phone onboarding
  const generateDynamicSessionQr = () => {
    const baseOrigin = customHostUrl.trim() || window.location.origin;
    const dynamicSessionId = 'SES-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const url = `${baseOrigin}/#mobile?kioskId=${kioskId}&session=${dynamicSessionId}`;
    setMobileDirectUrl(url);

    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: {
        dark: '#020617',
        light: '#ffffff',
      },
    })
      .then((dataUri) => {
        setSessionQrUrl(dataUri);
        setQrRefreshCountdown(300);
      })
      .catch((err) => console.error('QR code generation failed:', err));
  };

  useEffect(() => {
    generateDynamicSessionQr();
  }, [kioskId, customHostUrl]);

  const handleCopyLink = () => {
    if (navigator.clipboard && mobileDirectUrl) {
      navigator.clipboard.writeText(mobileDirectUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleSaveHostUrl = (url: string) => {
    const clean = url.trim().replace(/\/$/, '');
    setCustomHostUrl(clean);
    localStorage.setItem('kiosk_custom_host', clean);
    fetch('/api/config/kiosk-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customUrl: clean }),
    }).catch(() => {});
    setShowHostModal(false);
  };

  // Dynamic QR auto-refresh countdown
  useEffect(() => {
    if (currentStep !== 'TOUCHLESS_HOME') return;
    const interval = setInterval(() => {
      setQrRefreshCountdown((prev) => {
        if (prev <= 1) {
          generateDynamicSessionQr();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep]);

  // 2. Generate Dynamic UPI / Payment QR code when job requires payment
  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.status === 'PAYMENT_PENDING' || activeJob.status === 'AUTHENTICATED') {
      const amount = activeJob.totalPrice || 2;
      const trId = activeJob.id || 'JOB-1001';
      // Standard UPI deep link payload for India digital payments
      const upiPayload = `upi://pay?pa=smartprint@icici&pn=SmartPrintKiosk&am=${amount}&tr=${trId}&cu=INR&tn=Kiosk Print Job ${trId}`;

      QRCode.toDataURL(upiPayload, {
        width: 300,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((dataUri) => {
          setPaymentQrUrl(dataUri);
          setCurrentStep('PAYMENT_QR');
          setPaymentCountdown(180);
        })
        .catch((err) => console.error('Payment QR generation failed:', err));
    }
  }, [activeJob?.id, activeJob?.status, activeJob?.totalPrice]);

  // 3. Listen to external props or sync with active job
  useEffect(() => {
    if (externalMobileConnected) {
      setPairedCustomer({
        name: externalMobileConnected.customerName || 'Customer Mobile',
        phone: externalMobileConnected.customerPhone || 'Connected',
        sessionId: externalMobileConnected.sessionId || '',
      });
      if (currentStep === 'TOUCHLESS_HOME') {
        setCurrentStep('PHONE_PAIRED');
      }
    }
  }, [externalMobileConnected]);

  // Listen to mobile progress mirror
  useEffect(() => {
    if (!externalMobileProgress) return;
    const { step, details } = externalMobileProgress;

    if (step === 'UPLOADING') {
      setCurrentStep('UPLOADING_MIRROR');
      setMirroredUploadProgress(details?.percent || 45);
    } else if (step === 'UPLOAD_COMPLETE') {
      setMirroredUploadProgress(100);
      if (details) {
        setMirroredDocInfo({
          fileName: details.originalFileName || 'Document.pdf',
          totalPages: details.pageCount || 1,
          paperSize: details.paperSize || 'A4',
          colorMode: details.colorMode || 'BW',
          isDuplex: Boolean(details.isDuplex),
          copies: details.copies || 1,
          totalPrice: details.totalPrice || 2,
        });
      }
    } else if (step === 'CONFIG_UPDATE' && details) {
      setMirroredDocInfo((prev) => ({
        fileName: prev?.fileName || details.originalFileName || 'Document.pdf',
        totalPages: details.pageCount || prev?.totalPages || 1,
        paperSize: details.paperSize || prev?.paperSize || 'A4',
        colorMode: details.colorMode || prev?.colorMode || 'BW',
        isDuplex: details.isDuplex ?? prev?.isDuplex ?? false,
        copies: details.copies || prev?.copies || 1,
        totalPrice: details.totalPrice || prev?.totalPrice || 2,
      }));
    } else if (step === 'PAYMENT_PENDING') {
      setCurrentStep('PAYMENT_QR');
    }
  }, [externalMobileProgress]);

  // Sync state when activeJob updates via SSE
  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.status === 'PAUSED') {
      setCurrentStep('PAUSED');
    } else if (activeJob.status === 'PRINTING' || activeJob.status === 'QUEUED') {
      setCurrentStep('PRINTING');
      const total = (activeJob.pagesToPrintCount || 1) * (activeJob.copies || 1);
      setTotalPrintPages(total);
    } else if (activeJob.status === 'COMPLETED') {
      setCurrentStep('COMPLETED');
    } else if (activeJob.status === 'CANCELLED') {
      setCurrentStep('CANCELLED');
    } else if (activeJob.status === 'PAYMENT_PENDING' || activeJob.status === 'AUTHENTICATED') {
      setCurrentStep('PAYMENT_QR');
    } else if (activeJob.status === 'PRINTER_ERROR' || activeJob.status === 'FAILED') {
      setCurrentStep('ERROR');
    }
  }, [activeJob?.status]);

  // Update print page progress
  useEffect(() => {
    if (externalPrintProgress) {
      setCurrentPrintPage(externalPrintProgress.current);
      setTotalPrintPages(externalPrintProgress.total);
    }
  }, [externalPrintProgress]);

  // Payment Countdown Timer
  useEffect(() => {
    if (currentStep !== 'PAYMENT_QR') return;
    const interval = setInterval(() => {
      setPaymentCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep]);

  // Auto-close session on completion / cancellation
  useEffect(() => {
    if (currentStep !== 'COMPLETED' && currentStep !== 'CANCELLED') return;
    setSessionAutoCloseSeconds(15);
    const interval = setInterval(() => {
      setSessionAutoCloseSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          resetToHome();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep]);

  const resetToHome = () => {
    setCurrentStep('TOUCHLESS_HOME');
    setPairedCustomer(null);
    setMirroredDocInfo(null);
    setMirroredUploadProgress(0);
    generateDynamicSessionQr();
  };

  const handleSimulatePayment = async () => {
    if (!activeJob) return;
    try {
      const res = await fetch(`/api/jobs/${activeJob.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI_MANUAL',
          authorizedBy: 'KIOSK_DYNAMIC_QR',
          referenceId: 'UPI-REF-' + Math.floor(100000 + Math.random() * 900000),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onJobUpdated(data.job);
      }
    } catch (e) {
      console.error('Payment error:', e);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isPrinterUnavailable =
    kiosk?.printerStatus === 'OUT_OF_PAPER' ||
    kiosk?.printerStatus === 'PAPER_JAM' ||
    kiosk?.printerStatus === 'PRINTER_ERROR' ||
    kiosk?.printerStatus === 'OFFLINE' ||
    kiosk?.printerStatus === 'ERROR';

  const getPrinterStatusDisplay = (status?: string) => {
    switch (status) {
      case 'READY':
        return { label: 'Ready', color: 'text-emerald-400', dot: 'bg-emerald-500 animate-pulse' };
      case 'PRINTING':
        return { label: 'Printing', color: 'text-amber-400', dot: 'bg-amber-400 animate-spin' };
      case 'OUT_OF_PAPER':
        return { label: 'Out of Paper', color: 'text-rose-400', dot: 'bg-rose-500 animate-pulse' };
      case 'PAPER_JAM':
        return { label: 'Paper Jam', color: 'text-rose-400', dot: 'bg-rose-500 animate-pulse' };
      case 'LOW_TONER':
        return { label: 'Low Toner', color: 'text-yellow-400', dot: 'bg-yellow-400' };
      case 'PRINTER_ERROR':
      case 'ERROR':
        return { label: 'Printer Error', color: 'text-rose-400', dot: 'bg-rose-500' };
      case 'OFFLINE':
        return { label: 'Offline', color: 'text-slate-400', dot: 'bg-slate-500' };
      default:
        return { label: status || 'Ready', color: 'text-emerald-400', dot: 'bg-emerald-500' };
    }
  };

  const statusDisplay = getPrinterStatusDisplay(kiosk?.printerStatus);

  return (
    <div className="min-h-[820px] bg-slate-950 text-white rounded-3xl border border-slate-800 shadow-2xl flex flex-col justify-between overflow-hidden relative select-none">
      {/* KIOSK HARDWARE HEADER */}
      <header className="px-8 py-4 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Printer className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xl tracking-tight text-white">{t.brandTitle}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {kioskId}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Wifi className="w-2.5 h-2.5" />
                100% Touchless
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">{t.brandTagline}</p>
          </div>
        </div>

        {/* Hardware Status & Controls */}
        <div className="flex items-center gap-3">
          {/* Printer status badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700/60 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${statusDisplay.dot}`} />
            <span className="text-slate-300 font-medium">{t.printerStatus}:</span>
            <span className={`font-semibold ${statusDisplay.color}`}>{statusDisplay.label}</span>
          </div>

          {/* AI Voice Guide Button */}
          <button
            onClick={() => setShowVoiceModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition active:scale-95"
            title="Ask AI Voice Guide in any language"
          >
            <Mic className="w-3.5 h-3.5 text-blue-200 animate-pulse" />
            <span className="hidden sm:inline">AI Voice Guide</span>
          </button>

          {/* Language Selector */}
          <button
            onClick={() => setShowLangModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <span className="uppercase font-bold">{language}</span>
          </button>

          {/* Help Button */}
          <button
            onClick={() => setShowHelpModal(true)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title={t.help}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* TOP TOUCHLESS BANNER */}
      <div className="bg-gradient-to-r from-blue-950/60 via-slate-900/80 to-blue-950/60 border-b border-blue-500/20 px-8 py-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-blue-300">
          <Smartphone className="w-4 h-4 text-blue-400 animate-pulse" />
          <span className="font-semibold">
            {pairedCustomer
              ? `Paired with ${pairedCustomer.name} (${pairedCustomer.phone}) • Operating from Phone`
              : 'Zero Touch System: Scan the dynamic QR code with your phone to upload & control printing.'}
          </span>
        </div>
        {pairedCustomer && (
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/30 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            PHONE SYNCHRONIZED
          </span>
        )}
      </div>

      {/* MAIN KIOSK VIEWPORT */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 text-center relative z-10">
        {/* 1. TOUCHLESS HOME SCREEN (Dynamic QR Code Front & Center) */}
        {currentStep === 'TOUCHLESS_HOME' && (
          <div className="max-w-2xl w-full flex flex-col items-center animate-in fade-in zoom-in duration-300">
            {/* PRINTER UNAVAILABLE ALERT */}
            {isPrinterUnavailable && (
              <div className="mb-6 w-full px-5 py-4 bg-rose-500/15 border-2 border-rose-500/40 rounded-2xl flex items-start gap-3.5 text-rose-300 text-sm shadow-xl text-left">
                <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white text-base">
                    {t.printerUnavailable} ({statusDisplay.label})
                  </p>
                  <p className="text-xs text-rose-300/90 mt-1 leading-relaxed">
                    The printer is currently offline or reloading paper. Kiosk will resume automatically once ready.
                  </p>
                </div>
              </div>
            )}

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold mb-4 tracking-wide uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              Touchless Self-Service Printing Terminal
            </div>

            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white mb-2">
              {t.heroHeading}
            </h1>
            <p className="text-slate-300 text-sm md:text-base font-normal mb-6 max-w-lg">
              Scan the dynamic QR code below using your phone camera. You will upload documents, customize print settings, and manage printing completely from your phone.
            </p>

            {/* DYNAMIC SESSION QR CODE CARD */}
            <div className="relative p-6 bg-slate-900 border-2 border-blue-500/40 rounded-3xl shadow-2xl flex flex-col items-center max-w-md w-full">
              <div className="p-3 bg-white rounded-2xl shadow-inner mb-4 ring-4 ring-blue-500/20">
                {sessionQrUrl ? (
                  <img src={sessionQrUrl} alt="Scan to Start" className="w-56 h-56 md:w-64 md:h-64 rounded-xl" />
                ) : (
                  <div className="w-64 h-64 bg-slate-200 animate-pulse rounded-xl" />
                )}
              </div>

              <div className="flex items-center justify-between w-full px-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                  <span>Dynamic QR refreshes in:</span>
                  <strong className="text-blue-300 font-mono">{formatTimer(qrRefreshCountdown)}</strong>
                </div>
                <button
                  onClick={generateDynamicSessionQr}
                  className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              </div>

              {/* Active Mobile URL & Quick Actions */}
              <div className="mt-4 pt-3 border-t border-slate-800 w-full text-center space-y-2">
                <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-[11px] text-slate-300">
                  <span className="truncate flex-1 font-mono text-left text-slate-400">
                    {mobileDirectUrl || 'Generating dynamic pairing URL...'}
                  </span>
                  <button
                    onClick={handleCopyLink}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] shrink-0 transition"
                  >
                    {copiedLink ? 'Copied! ✓' : 'Copy Link'}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <button
                    onClick={() => {
                      setCustomHostInput(customHostUrl);
                      setShowHostModal(true);
                    }}
                    className="text-blue-400 hover:text-blue-300 font-semibold underline underline-offset-2 flex items-center gap-1"
                  >
                    <span>⚙️ Configure Kiosk Host URL</span>
                  </button>

                  <button
                    onClick={onSwitchToMobile}
                    className="text-slate-400 hover:text-white font-semibold underline underline-offset-2"
                  >
                    Open Customer Phone Panel →
                  </button>
                </div>

                {isCloudDev && !customHostUrl && (
                  <div className="mt-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left text-[11px] text-amber-300 leading-relaxed">
                    <p className="font-bold text-white mb-0.5">⚠️ Testing on a separate mobile phone?</p>
                    <p className="text-slate-300">
                      Cloud Run developer preview (<code className="text-amber-300">ais-dev</code>) blocks external devices with <strong>403 Forbidden</strong> because Google account auth is required.
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        onClick={onSwitchToMobile}
                        className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[10px]"
                      >
                        Test In-App Phone Tab
                      </button>
                      <button
                        onClick={() => {
                          setCustomHostInput(customHostUrl);
                          setShowHostModal(true);
                        }}
                        className="text-amber-400 hover:underline text-[10px] font-bold"
                      >
                        Set Tunnel / LAN IP →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Automatic Privacy File Shredding
              </span>
              <span>•</span>
              <span>A4 / A3 • Color & B/W</span>
              <span>•</span>
              <span>Laser Speed Windows Spooler</span>
            </div>
          </div>
        )}

        {/* 2. PHONE PAIRED SCREEN */}
        {currentStep === 'PHONE_PAIRED' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/20 animate-pulse">
              <Smartphone className="w-10 h-10" />
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold mb-3 uppercase">
              <Check className="w-3.5 h-3.5" />
              Phone Connected Hands-Free
            </div>

            <h2 className="text-3xl font-black text-white mb-2">
              Connected with {pairedCustomer?.name || 'Customer Phone'}
            </h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              Please look at your phone screen to choose your document and configure pages, color, and copies.
            </p>

            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 text-left space-y-3 shadow-xl">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Connected Customer:</span>
                <span className="font-bold text-white">{pairedCustomer?.name || 'Customer'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Mobile Number:</span>
                <span className="font-mono text-slate-300">{pairedCustomer?.phone || 'Verified'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Terminal Pairing:</span>
                <span className="text-emerald-400 font-bold">{kioskId} • Active Session</span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Waiting for customer to select documents on phone...</span>
            </div>
          </div>
        )}

        {/* 3. LIVE MIRROR OF MOBILE UPLOAD & CONFIGURATION BAR */}
        {currentStep === 'UPLOADING_MIRROR' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in fade-in duration-300">
            <div className="w-20 h-20 rounded-3xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center mb-6">
              <FileText className="w-10 h-10 animate-bounce" />
            </div>

            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">
              Receiving Document from Phone
            </h2>
            <p className="text-slate-300 text-sm mb-6">
              Customer is uploading and configuring the document from their phone.
            </p>

            {/* Live Upload Progress Bar Mirrored on Kiosk Screen */}
            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 shadow-xl text-left">
              <div className="flex justify-between text-xs text-slate-400 mb-2">
                <span>Upload & Page Processing:</span>
                <span className="font-bold text-blue-400">{mirroredUploadProgress}%</span>
              </div>

              <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden mb-4">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(10, mirroredUploadProgress)}%` }}
                />
              </div>

              {mirroredDocInfo && (
                <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">File:</span>
                    <span className="text-slate-200 font-semibold truncate max-w-[220px]">
                      {mirroredDocInfo.fileName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Settings:</span>
                    <span className="font-mono text-slate-300">
                      {mirroredDocInfo.paperSize} • {mirroredDocInfo.colorMode === 'COLOR' ? 'Color' : 'B&W'} •{' '}
                      {mirroredDocInfo.copies} {mirroredDocInfo.copies === 1 ? 'copy' : 'copies'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Estimated Total:</span>
                    <span className="text-emerald-400 font-bold text-sm">₹{mirroredDocInfo.totalPrice}</span>
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Once customer taps Start on their phone, the dynamic payment QR will be displayed here.
            </p>
          </div>
        )}

        {/* 4. DYNAMIC PAYMENT QR CODE ON KIOSK SCREEN */}
        {currentStep === 'PAYMENT_QR' && (
          <div className="max-w-xl w-full flex flex-col items-center animate-in fade-in duration-300">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold mb-3 uppercase">
              <DollarSign className="w-3.5 h-3.5" />
              Dynamic Payment QR Code
            </div>

            <h2 className="text-3xl md:text-4xl font-black text-white mb-1">
              Pay ₹{activeJob?.totalPrice ?? 16}
            </h2>
            <p className="text-slate-300 text-sm mb-5 max-w-md">
              Scan this dynamic QR code with any UPI or payment app on your phone to release the print job.
            </p>

            {/* DYNAMIC PAYMENT QR CARD */}
            <div className="p-5 bg-white rounded-3xl shadow-2xl ring-8 ring-amber-500/20 mb-5 flex flex-col items-center">
              {paymentQrUrl ? (
                <img src={paymentQrUrl} alt="UPI Payment QR" className="w-56 h-56 md:w-64 md:h-64 rounded-xl" />
              ) : (
                <div className="w-64 h-64 bg-slate-200 animate-pulse rounded-xl" />
              )}
              <div className="mt-3 flex items-center gap-3 text-slate-800 text-xs font-bold">
                <span>Google Pay</span>
                <span>•</span>
                <span>PhonePe</span>
                <span>•</span>
                <span>Paytm</span>
                <span>•</span>
                <span>BHIM UPI</span>
              </div>
            </div>

            {/* Payment Details & Timer */}
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-4 text-xs space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Job Reference:</span>
                <span className="font-mono text-white font-bold">{activeJob?.id || 'GG-10021'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Document:</span>
                <span className="text-slate-200 truncate max-w-[200px]">{activeJob?.originalFileName || 'Document.pdf'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment Timer:</span>
                <span className="font-mono text-amber-400 font-bold">{formatTimer(paymentCountdown)}</span>
              </div>
            </div>

            {/* Simulate / Desk Confirmation Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSimulatePayment}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition active:scale-95 flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>Simulate / Confirm Payment (₹{activeJob?.totalPrice ?? 16})</span>
              </button>
            </div>
          </div>
        )}

        {/* 5. PRINTING IN PROGRESS SCREEN (Controlled by phone) */}
        {currentStep === 'PRINTING' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in fade-in duration-300">
            <div className="w-24 h-24 rounded-3xl bg-blue-600/10 border border-blue-500/30 text-blue-400 flex items-center justify-center mb-6 relative">
              <Printer className="w-12 h-12 animate-bounce" />
              <div className="absolute inset-0 rounded-3xl border border-blue-400/40 animate-ping opacity-30" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-bold mb-3 uppercase">
              <Smartphone className="w-3.5 h-3.5" />
              Remote Controls Active on Phone
            </div>

            <h2 className="text-3xl font-extrabold text-white mb-2">{t.printingTitle}</h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              {t.printingDesc} You can Pause or Cancel printing anytime from your smartphone screen.
            </p>

            {/* Spooler Status & Progress Bar */}
            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 shadow-xl text-left">
              <div className="flex justify-between text-xs text-slate-400 mb-2">
                <span>Windows Print Spooler:</span>
                <span className="text-emerald-400 font-semibold">Active Spool Stream</span>
              </div>

              <div className="w-full bg-slate-800 h-3.5 rounded-full overflow-hidden mb-3">
                <div
                  className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(15, Math.min(100, (currentPrintPage / totalPrintPages) * 100))}%`,
                  }}
                />
              </div>

              <div className="flex justify-between text-xs text-slate-400">
                <span>
                  Printing page <strong>{currentPrintPage}</strong> of <strong>{totalPrintPages}</strong>...
                </span>
                <span className="font-mono text-slate-200">
                  {kiosk?.printerName || 'HP LaserJet Enterprise M608'}
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-400 flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Job is locked. File will be permanently purged after printing.</span>
            </div>
          </div>
        )}

        {/* 6. PAUSED STATE SCREEN */}
        {currentStep === 'PAUSED' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border-2 border-amber-500 text-amber-400 flex items-center justify-center mb-6 shadow-xl shadow-amber-500/20">
              <Pause className="w-10 h-10" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold mb-3 uppercase">
              <Pause className="w-3.5 h-3.5" />
              Printing Paused
            </div>

            <h2 className="text-3xl font-black text-white mb-2">Printing Paused by Customer Phone</h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              The print job has been temporarily held. Please tap <strong>Resume</strong> or <strong>Cancel</strong> on your phone.
            </p>

            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400">
              Progress: Page {currentPrintPage} of {totalPrintPages} printed
            </div>
          </div>
        )}

        {/* 7. CANCELLED SCREEN */}
        {currentStep === 'CANCELLED' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-3xl bg-rose-500/20 border-2 border-rose-500 text-rose-400 flex items-center justify-center mb-6 shadow-xl shadow-rose-500/20">
              <XCircle className="w-10 h-10" />
            </div>

            <h2 className="text-3xl font-black text-white mb-2">Print Job Cancelled by Phone</h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              The print job was stopped. All temporary uploaded documents have been securely erased from memory.
            </p>

            <div className="text-xs text-slate-500">
              Returning to Home screen in {sessionAutoCloseSeconds}s...
            </div>
          </div>
        )}

        {/* 8. PRINTING COMPLETED SCREEN */}
        {currentStep === 'COMPLETED' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in zoom-in duration-300">
            <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mb-6 shadow-2xl shadow-emerald-500/20">
              <CheckCircle2 className="w-14 h-14" />
            </div>

            <h2 className="text-3xl md:text-4xl font-black text-white mb-2">
              {t.completedTitle}
            </h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              Your document has been printed. Please collect your physical pages from the output tray below.
            </p>

            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400 mb-6 space-y-1">
              <div className="text-emerald-400 font-bold flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>{t.privacyNote}</span>
              </div>
              <p className="text-slate-500 text-center">Session auto-closes in {sessionAutoCloseSeconds} seconds.</p>
            </div>

            <button
              onClick={resetToHome}
              className="px-8 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-xl shadow-blue-600/30 transition active:scale-95"
            >
              {t.startNewPrint}
            </button>
          </div>
        )}

        {/* 9. ERROR SCREEN */}
        {currentStep === 'ERROR' && (
          <div className="max-w-lg w-full flex flex-col items-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-3xl bg-rose-500/20 border-2 border-rose-500 text-rose-400 flex items-center justify-center mb-6 shadow-xl shadow-rose-500/20">
              <AlertTriangle className="w-10 h-10" />
            </div>

            <h2 className="text-3xl font-black text-white mb-2">{t.somethingWentWrong}</h2>
            <p className="text-slate-300 text-sm mb-6 max-w-md">
              {activeJob?.errorMessage || 'A hardware spooler error occurred. Please contact the desk operator.'}
            </p>

            <button
              onClick={resetToHome}
              className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700"
            >
              {t.tryAgain}
            </button>
          </div>
        )}
      </main>

      {/* KIOSK FOOTER */}
      <footer className="px-8 py-4 bg-slate-900/80 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500 z-20">
        <div className="flex items-center gap-4">
          <span>{kiosk?.location || 'Central Library, Ground Floor'}</span>
          <span>•</span>
          <span>Kiosk Version {kiosk?.softwareVersion || 'v1.5.0'}</span>
        </div>

        <div className="flex items-center gap-2 text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Windows Spooler Direct Driver • SSL 256-Bit</span>
        </div>
      </footer>

      {/* MULTILINGUAL AI VOICE ASSISTANT MODAL */}
      <GeminiVoiceAssistant
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        language={language}
        currentStep={currentStep}
        printerStatus={kiosk?.printerStatus}
        kioskId={kioskId}
      />

      {/* LANGUAGE SELECTION MODAL */}
      {showLangModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" />
                {t.selectLanguage}
              </h3>
              <button
                onClick={() => setShowLangModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { code: 'en', name: 'English', native: 'English' },
                { code: 'mr', name: 'Marathi', native: 'मराठी' },
                { code: 'hi', name: 'Hindi', native: 'हिंदी' },
                { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
                { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
                { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
                { code: 'es', name: 'Spanish', native: 'Español' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    onLanguageChange(lang.code as Language);
                    setShowLangModal(false);
                  }}
                  className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
                    language === lang.code
                      ? 'bg-blue-600/20 border-blue-500 text-white'
                      : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span className="font-bold text-sm">{lang.native}</span>
                  <span className="text-[11px] text-slate-400">{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HELP MODAL */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-400" />
                {t.help}
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300 mb-6">
              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60">
                <h4 className="font-bold text-white text-sm mb-1">1. 100% Touchless Operation</h4>
                <p className="text-slate-400 leading-relaxed">
                  You never have to touch this screen! Simply scan the QR code with your smartphone camera. All uploading, configuration, and controls happen directly on your phone.
                </p>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60">
                <h4 className="font-bold text-white text-sm mb-1">2. Dynamic Payment QR</h4>
                <p className="text-slate-400 leading-relaxed">
                  Once your document is prepared, this screen shows a dynamic UPI payment QR code with the exact total amount. Scan and pay with any UPI app.
                </p>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60">
                <h4 className="font-bold text-white text-sm mb-1">3. Pause & Cancel From Phone</h4>
                <p className="text-slate-400 leading-relaxed">
                  While printing is running, your phone has active buttons to Pause, Resume, or Cancel the print job anytime.
                </p>
              </div>

              <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60">
                <h4 className="font-bold text-white text-sm mb-1">4. Privacy Guaranteed</h4>
                <p className="text-slate-400 leading-relaxed">
                  All uploaded document binaries are permanently deleted right after printing.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setShowHelpModal(false);
                setShowVoiceModal(true);
              }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
            >
              <Mic className="w-4 h-4" />
              <span>Talk with AI Voice Assistant Instead</span>
            </button>
          </div>
        </div>
      )}

      {/* KIOSK HOST / QR TARGET CONFIGURATION MODAL */}
      {showHostModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>⚙️ Kiosk QR Target Host Settings</span>
              </h3>
              <button
                onClick={() => setShowHostModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Configure the exact base URL embedded into the Kiosk QR code so external smartphones can connect seamlessly without network or authentication errors.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Custom Base URL (LAN IP or Public Domain / Tunnel):
                </label>
                <input
                  type="text"
                  value={customHostInput}
                  onChange={(e) => setCustomHostInput(e.target.value)}
                  placeholder="e.g. http://192.168.1.100:3000 or https://xxxx.ngrok-free.app"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setCustomHostInput(window.location.origin)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                >
                  Use Browser Origin
                </button>

                {window.location.origin.includes('ais-dev-') && (
                  <button
                    type="button"
                    onClick={() => setCustomHostInput(window.location.origin.replace('ais-dev-', 'ais-pre-'))}
                    className="px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 text-[11px] border border-blue-500/30"
                  >
                    Switch to Shared Preview URL
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setCustomHostInput('')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px]"
                >
                  Reset Default
                </button>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-200">ℹ️ Deployment & Network Guide:</p>
                <p>• <strong>Windows Physical Kiosk:</strong> Set to your local LAN IP (e.g. <code>http://192.168.1.50:3000</code>) so customers on the same WiFi can scan.</p>
                <p>• <strong>Production Terminal:</strong> Set to your public domain (e.g. <code>https://print.mykiosk.com</code>).</p>
                <p>• <strong>AI Studio Preview:</strong> <code>ais-dev</code> requires Google login. Use the in-app phone simulator or a public tunnel to test from external phones.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleSaveHostUrl(customHostInput)}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/20"
              >
                Save & Update QR Code
              </button>
              <button
                type="button"
                onClick={() => setShowHostModal(false)}
                className="px-5 py-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
