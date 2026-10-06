import React, { useState, useEffect } from 'react';
import {
  Upload,
  FileText,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Printer,
  ChevronRight,
  AlertCircle,
  Copy,
  Sparkles,
  RefreshCw,
  Sliders,
  DollarSign,
  ArrowLeft,
  Check,
  Smartphone,
  Pause,
  Play,
  XCircle,
  Mic,
  Download,
  Share2,
} from 'lucide-react';
import { ColorMode, Language, Orientation, PaperSize, PrintJobData } from '../types/kiosk.ts';
import { translations } from '../i18n/translations.ts';
import { GeminiVoiceAssistant } from '../../frontend/components/GeminiVoiceAssistant.tsx';

interface MobileCustomerFlowProps {
  kioskId: string;
  language: Language;
  onJobSubmitted: (job: PrintJobData, otp: string) => void;
  activeJob: PrintJobData | null;
  otpCode: string;
  printerStatus?: string;
  onJobUpdated?: (job: PrintJobData) => void;
}

export const MobileCustomerFlow: React.FC<MobileCustomerFlowProps> = ({
  kioskId,
  language,
  onJobSubmitted,
  activeJob,
  otpCode,
  printerStatus = 'READY',
  onJobUpdated,
}) => {
  const t = translations[language] || translations.en;

  // Step flow: 1: INFO -> 2: UPLOAD -> 3: CONFIG -> 4: PAYMENT_READY -> 5: REMOTE_CONTROL
  type MobileStep = 'INFO' | 'UPLOAD' | 'CONFIG' | 'PAYMENT_READY' | 'REMOTE_CONTROL';
  const [mobileStep, setMobileStep] = useState<MobileStep>('INFO');

  // Customer Info
  const [fullName, setFullName] = useState('Rahul Sharma');
  const [mobileNumber, setMobileNumber] = useState('9876543210');
  const [email, setEmail] = useState('');
  const [infoError, setInfoError] = useState('');

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [docMetadata, setDocMetadata] = useState<{
    originalFileName: string;
    fileSize: number;
    fileType: string;
    pageCount: number;
    tempFilePath: string;
  } | null>(null);

  // Print Configuration
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [colorMode, setColorMode] = useState<ColorMode>('BW');
  const [isDuplex, setIsDuplex] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [copies, setCopies] = useState(1);
  const [pageRangeMode, setPageRangeMode] = useState<'all' | 'custom'>('all');
  const [customRangeInput, setCustomRangeInput] = useState('');
  const [rangeError, setRangeError] = useState('');

  // Calculated Pricing from Backend
  const [pricingBreakdown, setPricingBreakdown] = useState<{
    unitPrice: number;
    pagesToPrintCount: number;
    totalPrints: number;
    totalPrice: number;
    breakdown: string;
  }>({
    unitPrice: 2,
    pagesToPrintCount: 1,
    totalPrints: 1,
    totalPrice: 2,
    breakdown: '1 page × 1 copy = 1 print @ ₹2 = ₹2',
  });

  const [isCalculatingPrice, setIsCalculatingPrice] = useState(false);
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  // Session ID
  const [sessionId] = useState(() => 'SES-' + Math.random().toString(36).substring(2, 8).toUpperCase());

  // Notify Kiosk of mobile pairing on initial mount
  useEffect(() => {
    fetch('/api/sessions/mobile-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        kioskId,
        customerName: fullName,
        customerPhone: mobileNumber,
      }),
    }).catch((e) => console.error('Mobile connect notification failed:', e));
  }, [kioskId, sessionId]);

  // Sync step if activeJob changes
  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.status === 'PAYMENT_PENDING' || activeJob.status === 'OTP_PENDING') {
      setMobileStep('PAYMENT_READY');
    } else if (
      activeJob.status === 'PAID' ||
      activeJob.status === 'QUEUED' ||
      activeJob.status === 'PRINTING' ||
      activeJob.status === 'PAUSED' ||
      activeJob.status === 'COMPLETED' ||
      activeJob.status === 'CANCELLED'
    ) {
      setMobileStep('REMOTE_CONTROL');
    }
  }, [activeJob?.status]);

  // Recalculate price whenever settings change
  useEffect(() => {
    if (!docMetadata) return;

    const calcTimer = setTimeout(async () => {
      setIsCalculatingPrice(true);
      setRangeError('');

      try {
        const res = await fetch('/api/pricing/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paperSize,
            colorMode,
            isDuplex,
            copies,
            pageRange: pageRangeMode === 'all' ? 'all' : customRangeInput,
            totalPagesInDoc: docMetadata.pageCount,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          setPricingBreakdown({
            unitPrice: data.unitPrice,
            pagesToPrintCount: data.pagesToPrintCount,
            totalPrints: data.totalPrints,
            totalPrice: data.totalPrice,
            breakdown: data.breakdown,
          });

          // Mirror live config to physical kiosk screen
          fetch('/api/sessions/mobile-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              kioskId,
              step: 'CONFIG_UPDATE',
              details: {
                originalFileName: docMetadata.originalFileName,
                pageCount: docMetadata.pageCount,
                paperSize,
                colorMode,
                isDuplex,
                copies,
                totalPrice: data.totalPrice,
              },
            }),
          }).catch(() => {});
        } else {
          setRangeError(data.error || 'Invalid configuration');
        }
      } catch (err) {
        console.error('Pricing calculation failed:', err);
      } finally {
        setIsCalculatingPrice(false);
      }
    }, 200);

    return () => clearTimeout(calcTimer);
  }, [paperSize, colorMode, isDuplex, copies, pageRangeMode, customRangeInput, docMetadata, kioskId, sessionId]);

  // 1. Submit Customer Info
  const handleProceedFromInfo = () => {
    if (!fullName.trim()) {
      setInfoError('Please enter your full name.');
      return;
    }
    if (!mobileNumber.trim() || mobileNumber.replace(/\D/g, '').length < 10) {
      setInfoError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setInfoError('');

    // Broadcast customer name to Kiosk
    fetch('/api/sessions/mobile-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        kioskId,
        customerName: fullName.trim(),
        customerPhone: mobileNumber.trim(),
      }),
    }).catch(() => {});

    setMobileStep('UPLOAD');
  };

  // 2. Handle Document Upload with Real-time Progress & Instantaneous Processing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsUploading(true);
    setUploadError('');
    setUploadProgress(10);

    // Notify kiosk of upload starting
    fetch('/api/sessions/mobile-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        kioskId,
        step: 'UPLOADING',
        details: { percent: 15 },
      }),
    }).catch(() => {});

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.min(95, Math.round((event.loaded / event.total) * 100));
        setUploadProgress(percent);

        // Mirror progress to kiosk screen
        fetch('/api/sessions/mobile-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            kioskId,
            step: 'UPLOADING',
            details: { percent },
          }),
        }).catch(() => {});
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      setUploadProgress(100);

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          setDocMetadata({
            originalFileName: data.originalFileName,
            fileSize: data.fileSize,
            fileType: data.fileType,
            pageCount: data.pageCount,
            tempFilePath: data.tempFilePath,
          });

          // Pre-populate pricing instantly without an extra network roundtrip
          if (data.initialPricing) {
            setPricingBreakdown({
              unitPrice: data.initialPricing.unitPrice,
              pagesToPrintCount: data.initialPricing.pagesToPrintCount,
              totalPrints: data.initialPricing.totalPrints,
              totalPrice: data.initialPricing.totalPrice,
              breakdown: data.initialPricing.breakdown,
            });
          }

          // Mirror document uploaded state to kiosk screen
          fetch('/api/sessions/mobile-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              kioskId,
              step: 'UPLOAD_COMPLETE',
              details: {
                originalFileName: data.originalFileName,
                pageCount: data.pageCount,
                fileSize: data.fileSize,
                paperSize,
                colorMode,
                isDuplex,
                copies,
                totalPrice: data.initialPricing?.totalPrice || 2,
              },
            }),
          }).catch(() => {});

          setMobileStep('CONFIG');
        } catch (parseErr) {
          setUploadError('Failed to parse document response');
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          setUploadError(errData.error || 'Failed to process document');
        } catch (_) {
          setUploadError(`Upload failed with status ${xhr.status}`);
        }
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setUploadError('Network error during file upload. Please check connection and try again.');
    };

    xhr.send(formData);
  };

  // 3. Submit Print Job & Execute Instant Touchless Handshake
  const handleStartPrinting = async () => {
    if (!docMetadata) return;

    setIsSubmittingJob(true);
    try {
      // Create job
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kioskId,
          sessionId,
          customerName: fullName.trim(),
          customerPhone: mobileNumber.trim(),
          customerEmail: email.trim() || undefined,
          originalFileName: docMetadata.originalFileName,
          fileType: docMetadata.fileType,
          fileSize: docMetadata.fileSize,
          tempFilePath: docMetadata.tempFilePath,
          totalPagesInDoc: docMetadata.pageCount,
          selectedPageRange: pageRangeMode === 'all' ? 'all' : customRangeInput,
          paperSize,
          colorMode,
          isDuplex,
          orientation,
          copies,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create print job');
      }

      const createdJob = data.job;
      onJobSubmitted(createdJob, data.otp?.otpCode || '');

      // Execute Touchless Handshake with Kiosk (Zero Screen Touch Required)
      const authRes = await fetch(`/api/jobs/${createdJob.id}/touchless-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        if (onJobUpdated && authData.job) {
          onJobUpdated(authData.job);
        }
      }

      setMobileStep('PAYMENT_READY');
    } catch (err: any) {
      alert(err.message || 'Failed to submit print job');
    } finally {
      setIsSubmittingJob(false);
    }
  };

  // 4. Instant Pay from Phone (or scan Kiosk Dynamic QR)
  const handleInstantPay = async () => {
    if (!activeJob) return;
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/jobs/${activeJob.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'UPI_MANUAL',
          authorizedBy: 'CUSTOMER_PHONE_UPI',
          referenceId: 'UPI-MOB-' + Math.floor(100000 + Math.random() * 900000),
        }),
      });
      const data = await res.json();
      if (res.ok && data.job) {
        if (onJobUpdated) onJobUpdated(data.job);
        setMobileStep('REMOTE_CONTROL');
      }
    } catch (e) {
      console.error('Payment error:', e);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 5. Remote Mobile Controls: Pause, Resume, Cancel
  const handlePauseJob = async () => {
    if (!activeJob) return;
    setIsActionLoading(true);
    try {
      await fetch(`/api/jobs/${activeJob.id}/pause`, { method: 'POST' });
    } catch (e) {
      console.error('Pause failed:', e);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResumeJob = async () => {
    if (!activeJob) return;
    setIsActionLoading(true);
    try {
      await fetch(`/api/jobs/${activeJob.id}/resume`, { method: 'POST' });
    } catch (e) {
      console.error('Resume failed:', e);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    if (!confirm('Are you sure you want to cancel this print job? Any uploaded files will be permanently deleted.')) {
      return;
    }
    setIsActionLoading(true);
    try {
      await fetch(`/api/jobs/${activeJob.id}/cancel`, { method: 'POST' });
    } catch (e) {
      console.error('Cancel failed:', e);
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col min-h-[700px]">
      {/* MOBILE PORTAL HEADER */}
      <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-sm text-white block leading-tight">Mobile Print Terminal</span>
            <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Paired with Kiosk {kioskId} • Touchless
            </span>
          </div>
        </div>

        {/* AI Voice Guide Button for Phone */}
        <button
          onClick={() => setShowVoiceModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-md shadow-blue-500/20 active:scale-95"
        >
          <Mic className="w-3.5 h-3.5 text-blue-200 animate-pulse" />
          <span>Voice Help</span>
        </button>
      </div>

      {/* STEP PROGRESS TRACKER */}
      <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-slate-400">
        <span className={mobileStep === 'INFO' ? 'text-blue-400 font-extrabold' : ''}>1. Info</span>
        <span>→</span>
        <span className={mobileStep === 'UPLOAD' ? 'text-blue-400 font-extrabold' : ''}>2. Upload</span>
        <span>→</span>
        <span className={mobileStep === 'CONFIG' ? 'text-blue-400 font-extrabold' : ''}>3. Settings</span>
        <span>→</span>
        <span className={mobileStep === 'PAYMENT_READY' ? 'text-blue-400 font-extrabold' : ''}>4. Pay</span>
        <span>→</span>
        <span className={mobileStep === 'REMOTE_CONTROL' ? 'text-emerald-400 font-extrabold' : ''}>5. Control</span>
      </div>

      {/* MAIN MOBILE BODY */}
      <div className="flex-1 p-5 overflow-y-auto">
        {/* STEP 1: CUSTOMER INFORMATION */}
        {mobileStep === 'INFO' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Your Details</h3>
              <p className="text-xs text-slate-400">
                Required for receipt generation and secure session pairing.
              </p>
            </div>

            {infoError && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{infoError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile Number (10 digits)</label>
              <input
                type="tel"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="e.g. 9876543210"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address (Optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="pt-2">
              <button
                onClick={handleProceedFromInfo}
                className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-xl shadow-blue-600/20 transition flex items-center justify-center gap-2 active:scale-95"
              >
                <span>Continue to Upload Document</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: DOCUMENT UPLOAD */}
        {mobileStep === 'UPLOAD' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white mb-0.5">Upload Document</h3>
                <p className="text-xs text-slate-400">PDF, Word DOCX, PPTX, JPG, PNG (Max 50MB)</p>
              </div>
              <button
                onClick={() => setMobileStep('INFO')}
                className="text-xs text-slate-400 hover:text-white"
              >
                Back
              </button>
            </div>

            {uploadError && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{uploadError}</span>
              </div>
            )}

            <div className="relative border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-6 text-center bg-slate-950/80 transition flex flex-col items-center justify-center">
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />

              <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-3">
                <Upload className="w-7 h-7" />
              </div>

              <h4 className="font-bold text-white text-sm mb-1">
                {uploadedFile ? uploadedFile.name : 'Tap to Browse or Drop Document'}
              </h4>
              <p className="text-xs text-slate-400">
                Uploaded document will be automatically mirrored on Kiosk screen.
              </p>
            </div>

            {isUploading && (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
                <div className="flex justify-between text-xs text-slate-300 font-semibold">
                  <span>Uploading & analyzing pages...</span>
                  <span className="text-blue-400">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Mirrored live on Kiosk {kioskId} screen.
                </p>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: PRINT CONFIGURATION */}
        {mobileStep === 'CONFIG' && docMetadata && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Print Configuration</h3>
                <p className="text-xs text-slate-400">
                  {docMetadata.originalFileName} ({docMetadata.pageCount} pages)
                </p>
              </div>
              <button
                onClick={() => setMobileStep('UPLOAD')}
                className="text-xs text-slate-400 hover:text-white"
              >
                Change File
              </button>
            </div>

            {/* Paper Size & Color Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Paper Size</label>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPaperSize('A4')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      paperSize === 'A4' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    A4
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaperSize('A3')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      paperSize === 'A3' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    A3
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Color Mode</label>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setColorMode('BW')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      colorMode === 'BW' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    B&W (₹2)
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorMode('COLOR')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      colorMode === 'COLOR' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Color (₹10)
                  </button>
                </div>
              </div>
            </div>

            {/* Duplex and Copies */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Sides</label>
                <button
                  type="button"
                  onClick={() => setIsDuplex(!isDuplex)}
                  className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition ${
                    isDuplex
                      ? 'bg-blue-600/10 border-blue-500 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <span>{isDuplex ? 'Double-sided' : 'Single-sided'}</span>
                  {isDuplex && <Check className="w-3.5 h-3.5 text-blue-400" />}
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Copies</label>
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCopies((p) => Math.max(1, p - 1))}
                    className="w-9 py-1.5 text-slate-400 hover:text-white font-bold"
                  >
                    -
                  </button>
                  <span className="flex-1 text-center font-bold text-xs text-white">{copies}</span>
                  <button
                    type="button"
                    onClick={() => setCopies((p) => Math.min(20, p + 1))}
                    className="w-9 py-1.5 text-slate-400 hover:text-white font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Page Range */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Pages to Print</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setPageRangeMode('all');
                    setCustomRangeInput('');
                  }}
                  className={`py-1.5 rounded-xl text-xs font-semibold border transition ${
                    pageRangeMode === 'all'
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800'
                  }`}
                >
                  All ({docMetadata.pageCount} pages)
                </button>
                <button
                  type="button"
                  onClick={() => setPageRangeMode('custom')}
                  className={`py-1.5 rounded-xl text-xs font-semibold border transition ${
                    pageRangeMode === 'custom'
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800'
                  }`}
                >
                  Custom Range
                </button>
              </div>

              {pageRangeMode === 'custom' && (
                <input
                  type="text"
                  value={customRangeInput}
                  onChange={(e) => setCustomRangeInput(e.target.value)}
                  placeholder="e.g. 1-3, 5"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-xs focus:border-blue-500 focus:outline-none"
                />
              )}
              {rangeError && <p className="text-[11px] text-rose-400 mt-1">{rangeError}</p>}
            </div>

            {/* Calculated Price Breakdown */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
              <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                <span>Calculated Rate:</span>
                <span className="font-mono text-slate-300">₹{pricingBreakdown.unitPrice}/page</span>
              </div>
              <p className="text-xs text-slate-400 mb-2">{pricingBreakdown.breakdown}</p>
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                <span className="text-xs font-bold text-white">Total Amount:</span>
                <span className="text-2xl font-black text-emerald-400">₹{pricingBreakdown.totalPrice}</span>
              </div>
            </div>

            <button
              onClick={handleStartPrinting}
              disabled={isSubmittingJob || isCalculatingPrice}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-xl shadow-blue-600/30 transition flex items-center justify-center gap-2 active:scale-95"
            >
              {isSubmittingJob ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Connecting with Kiosk Hands-Free...</span>
                </>
              ) : (
                <span>START PRINTING (TOUCHLESS)</span>
              )}
            </button>
          </div>
        )}

        {/* STEP 4: PAYMENT READY SCREEN */}
        {mobileStep === 'PAYMENT_READY' && (
          <div className="space-y-4 text-center animate-in zoom-in duration-200">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>

            <div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">
                Hands-Free Authentication Confirmed
              </span>
              <h3 className="text-2xl font-black text-white mt-2">Ready for Payment</h3>
              <p className="text-xs text-slate-300 mt-1 max-w-xs mx-auto">
                Kiosk screen is now displaying the <strong>Dynamic Payment QR Code</strong>.
              </p>
            </div>

            {/* Bill summary card */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Job Reference:</span>
                <span className="font-mono text-white font-bold">{activeJob?.id || 'GG-10021'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payable Amount:</span>
                <span className="text-emerald-400 font-bold text-base">
                  ₹{activeJob?.totalPrice || pricingBreakdown.totalPrice}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Kiosk Terminal:</span>
                <span className="text-slate-200 font-semibold">{kioskId}</span>
              </div>
            </div>

            {/* Instruction Banner */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left text-xs text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-white">
                <DollarSign className="w-4 h-4 text-amber-400" />
                Scan Dynamic QR on Kiosk Screen
              </p>
              <p className="text-slate-400 text-[11px]">
                Scan the dynamic QR code shown on the kiosk monitor with Google Pay, PhonePe, Paytm, or BHIM.
              </p>
            </div>

            {/* Direct Instant Pay button right from phone */}
            <button
              onClick={handleInstantPay}
              disabled={isActionLoading}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl shadow-emerald-600/30 transition flex items-center justify-center gap-2 active:scale-95"
            >
              {isActionLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <span>Pay ₹{activeJob?.totalPrice || pricingBreakdown.totalPrice} Now via Phone</span>
              )}
            </button>
          </div>
        )}

        {/* STEP 5: ACTIVE REMOTE CONTROL CONSOLE */}
        {mobileStep === 'REMOTE_CONTROL' && (
          <div className="space-y-4 text-center animate-in fade-in duration-200">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-bold uppercase">
              <Smartphone className="w-3.5 h-3.5" />
              Active Remote Control Console
            </div>

            <h3 className="text-2xl font-black text-white">
              {activeJob?.status === 'PAUSED'
                ? 'Printing Paused'
                : activeJob?.status === 'COMPLETED'
                ? 'Printing Completed!'
                : activeJob?.status === 'CANCELLED'
                ? 'Print Cancelled'
                : 'Printing in Progress...'}
            </h3>

            {/* Status indicator card */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left text-xs space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Current Status:</span>
                <span
                  className={`px-2.5 py-0.5 rounded-md font-bold text-xs ${
                    activeJob?.status === 'COMPLETED'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : activeJob?.status === 'PAUSED'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : activeJob?.status === 'CANCELLED'
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-blue-500/15 text-blue-400 border border-blue-500/30 animate-pulse'
                  }`}
                >
                  {activeJob?.status || 'PRINTING'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Job Reference:</span>
                <span className="font-mono text-white font-bold">{activeJob?.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Paid:</span>
                <span className="text-emerald-400 font-bold">₹{activeJob?.totalPrice}</span>
              </div>
            </div>

            {/* Active remote controls: Pause, Resume, Cancel */}
            {activeJob?.status !== 'COMPLETED' && activeJob?.status !== 'CANCELLED' && (
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
                <p className="text-xs text-slate-300 font-bold text-left">
                  Remote Controls for Kiosk {kioskId}:
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {activeJob?.status === 'PAUSED' ? (
                    <button
                      onClick={handleResumeJob}
                      disabled={isActionLoading}
                      className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Resume Print</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseJob}
                      disabled={isActionLoading}
                      className="py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pause Print</span>
                    </button>
                  )}

                  <button
                    onClick={handleCancelJob}
                    disabled={isActionLoading}
                    className="py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Cancel Print</span>
                  </button>
                </div>
              </div>
            )}

            {/* Completion message */}
            {activeJob?.status === 'COMPLETED' && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-left text-xs space-y-2">
                <p className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Print job completed successfully!
                </p>
                <p className="text-slate-300">
                  Please collect your documents from the kiosk physical output tray.
                </p>
                <div className="pt-2 border-t border-emerald-500/20 text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Your file has been completely shredded from storage.</span>
                </div>
              </div>
            )}

            {/* Receipt Actions */}
            <div className="pt-2">
              <button
                onClick={() =>
                  alert(`Digital Receipt:\nJob: ${activeJob?.id}\nAmount: ₹${activeJob?.totalPrice}\nTerminal: ${kioskId}\nStatus: Paid & Verified`)
                }
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                <span>View & Download Digital Receipt</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>SSL 256-Bit Encrypted • Privacy Guaranteed</span>
      </div>

      {/* AI VOICE ASSISTANT ON PHONE */}
      <GeminiVoiceAssistant
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        language={language}
        currentStep={mobileStep}
        printerStatus={printerStatus}
        kioskId={kioskId}
      />
    </div>
  );
};
