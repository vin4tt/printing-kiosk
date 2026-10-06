import express, { Request, Response } from 'express';
import http from 'http';
import multer from 'multer';
import { applySecurityHeaders, createRateLimiter, sanitizeString } from './middleware/security.ts';
import { analyzeUploadedDocument } from './services/fileProcessor.ts';
import { calculatePrintPrice, parseAndValidatePageRange } from './services/pricingEngine.ts';
import { generateJobOtp, verifyKioskOtp } from './services/otpService.ts';
import { printerService } from './services/printerService.ts';
import { startCleanupWorker } from './services/cleanupWorker.ts';
import { getGeminiVoiceGuidance } from './services/geminiVoiceGuide.ts';
import {
  confirmJobPayment,
  createPrintJob,
  createSession,
  getAuditLogs,
  getKioskById,
  getKiosks,
  getOrCreateCustomer,
  getPricingRules,
  getPrintJobById,
  getPrintJobs,
  getPrinters,
  updatePricingRule,
  updatePrinterSupplyLevels,
  updateJobStatus,
} from '../database/dao.ts';
import { ColorMode, PaperSize, PaymentMethod, PrinterStatus } from '../frontend/types/kiosk.ts';

const app = express();
const server = http.createServer(app);

// Apply strict security headers & parsing
app.use(applySecurityHeaders);

// CORS headers to enable mobile and cross-origin connectivity
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Start background privacy disk cleanup daemon
startCleanupWorker();

// In-memory SSE connections for instant real-time pushes
const sseClients = new Set<Response>();

export function broadcastSse(eventType: string, data: any) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Hook printer service events to SSE broadcast
printerService.subscribe((event) => {
  broadcastSse(event.type, event.payload);
});

// SSE Stream endpoint
app.get('/api/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`event: CONNECTED\ndata: {"time": "${new Date().toISOString()}"}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Multer upload config (Memory storage for immediate conversion & page analysis)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Rate limiters for security
const otpRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Too many OTP attempts. Please wait 1 minute before trying again.',
});

const uploadRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 25,
  message: 'Upload rate limit reached. Please wait a few minutes.',
});

const aiVoiceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Voice assistant rate limit reached.',
});

// 1. Kiosks
app.get('/api/kiosks', async (_req, res) => {
  try {
    const list = await getKiosks();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch kiosks' });
  }
});

app.get('/api/kiosks/:id', async (req, res) => {
  try {
    const kiosk = await getKioskById(sanitizeString(req.params.id));
    if (!kiosk) return res.status(404).json({ error: 'Kiosk not found' });
    res.json(kiosk);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch kiosk' });
  }
});

// 2. Sessions & Touchless Mobile Pairing
app.post('/api/sessions/create', async (req, res) => {
  try {
    const kioskId = sanitizeString(req.body.kioskId);
    if (!kioskId) return res.status(400).json({ error: 'kioskId is required' });

    const sessionId = 'SES-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const session = await createSession(sessionId, kioskId, 15);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Mobile connects to kiosk session (Touchless hand-off)
app.post('/api/sessions/mobile-connect', async (req, res) => {
  try {
    const { sessionId, kioskId = 'KSK-001', customerName, customerPhone } = req.body;
    broadcastSse('MOBILE_CONNECTED', {
      sessionId,
      kioskId,
      customerName: sanitizeString(customerName),
      customerPhone: sanitizeString(customerPhone),
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Kiosk paired with mobile phone.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to notify kiosk of mobile connection' });
  }
});

// Mobile mirrors step progression to Kiosk screen
app.post('/api/sessions/mobile-progress', async (req, res) => {
  try {
    const { sessionId, kioskId = 'KSK-001', step, details } = req.body;
    broadcastSse('MOBILE_PROGRESS', {
      sessionId,
      kioskId,
      step,
      details,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to mirror progress' });
  }
});

// 3. Document Upload & Standardized Conversion
app.post('/api/upload', uploadRateLimiter, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = sanitizeString(req.file.originalname);
    const buffer = req.file.buffer;
    const mimetype = req.file.mimetype;

    const result = await analyzeUploadedDocument(buffer, originalName, mimetype);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    // Pre-calculate initial default pricing (A4, B&W, 1 copy) to save a frontend network roundtrip
    const initialPricing = await calculatePrintPrice({
      paperSize: 'A4',
      colorMode: 'BW',
      isDuplex: false,
      copies: 1,
      pagesToPrintCount: result.pageCount,
    });

    res.json({
      ...result,
      initialPricing: {
        ...initialPricing,
        pageNumbers: Array.from({ length: result.pageCount }, (_, i) => i + 1),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to process and convert document' });
  }
});

// In-memory custom host configuration for kiosk QR code
let customKioskHostUrl: string = process.env.CUSTOM_KIOSK_HOST || '';

app.get('/api/config/kiosk-url', (req: Request, res: Response) => {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const autoOrigin = `${protocol}://${host}`;

  res.json({
    activeUrl: customKioskHostUrl || autoOrigin,
    autoDetectedUrl: autoOrigin,
    customConfiguredUrl: customKioskHostUrl,
    isCloudDev: autoOrigin.includes('ais-dev-'),
    sharedUrlSuggestion: autoOrigin.includes('ais-dev-') ? autoOrigin.replace('ais-dev-', 'ais-pre-') : null,
  });
});

app.post('/api/config/kiosk-url', (req: Request, res: Response) => {
  const { customUrl } = req.body;
  if (typeof customUrl === 'string') {
    customKioskHostUrl = customUrl.trim();
  }
  res.json({ success: true, customKioskHostUrl });
});

// 4. Calculate Price
app.post('/api/pricing/calculate', async (req, res) => {
  try {
    const {
      paperSize = 'A4',
      colorMode = 'BW',
      isDuplex = false,
      copies = 1,
      pageRange = 'all',
      totalPagesInDoc = 1,
    } = req.body;

    const rangeCheck = parseAndValidatePageRange(String(pageRange), Number(totalPagesInDoc));
    if (!rangeCheck.valid) {
      return res.status(400).json({ error: rangeCheck.error });
    }

    const calc = await calculatePrintPrice({
      paperSize: paperSize as PaperSize,
      colorMode: colorMode as ColorMode,
      isDuplex: Boolean(isDuplex),
      copies: Number(copies),
      pagesToPrintCount: rangeCheck.pagesCount,
    });

    res.json({
      ...calc,
      pageNumbers: rangeCheck.pageNumbers,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// 5. Submit Print Job and Generate OTP
app.post('/api/jobs/create', async (req, res) => {
  try {
    const {
      kioskId,
      sessionId,
      customerName,
      customerPhone,
      customerEmail,
      originalFileName,
      fileType,
      fileSize,
      tempFilePath,
      totalPagesInDoc,
      selectedPageRange = 'all',
      paperSize = 'A4',
      colorMode = 'BW',
      isDuplex = false,
      orientation = 'portrait',
      copies = 1,
    } = req.body;

    const cleanKiosk = sanitizeString(kioskId);
    const cleanPhone = sanitizeString(customerPhone);
    const cleanName = sanitizeString(customerName);
    const cleanFile = sanitizeString(originalFileName);

    if (!cleanKiosk || !cleanPhone || !cleanName || !cleanFile) {
      return res.status(400).json({ error: 'Missing required print job fields' });
    }

    const customer = await getOrCreateCustomer(cleanName, cleanPhone, customerEmail ? sanitizeString(customerEmail) : undefined);

    const rangeCheck = parseAndValidatePageRange(selectedPageRange, totalPagesInDoc || 1);
    if (!rangeCheck.valid) {
      return res.status(400).json({ error: rangeCheck.error });
    }

    const calc = await calculatePrintPrice({
      paperSize: paperSize as PaperSize,
      colorMode: colorMode as ColorMode,
      isDuplex: Boolean(isDuplex),
      copies: Number(copies),
      pagesToPrintCount: rangeCheck.pagesCount,
    });

    const jobId = 'GG-' + Math.floor(10000 + Math.random() * 90000).toString();

    const job = await createPrintJob({
      id: jobId,
      sessionId: sanitizeString(sessionId),
      kioskId: cleanKiosk,
      userId: customer.uid,
      customerName: customer.fullName,
      customerPhone: customer.mobileNumber,
      originalFileName: cleanFile,
      fileType: fileType || 'PDF',
      fileSize: fileSize || 1024,
      tempFilePath,
      totalPagesInDoc: totalPagesInDoc || 1,
      selectedPageRange,
      pagesToPrintCount: rangeCheck.pagesCount,
      paperSize,
      colorMode,
      isDuplex: Boolean(isDuplex),
      orientation,
      copies: Number(copies),
      unitPrice: calc.unitPrice,
      totalPrice: calc.totalPrice,
    });

    const otpResult = await generateJobOtp({
      jobId: job.id,
      sessionId: job.sessionId,
      kioskId: job.kioskId,
    });

    broadcastSse('NEW_PRINT_JOB', {
      jobId: job.id,
      kioskId: job.kioskId,
      totalPrice: job.totalPrice,
    });

    res.json({
      job,
      otp: otpResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create print job' });
  }
});

// 6. Verify OTP with Rate Limiting & Brute-Force Shield
app.post('/api/kiosk/verify-otp', otpRateLimiter, async (req, res) => {
  try {
    const kioskId = sanitizeString(req.body.kioskId);
    const enteredOtp = sanitizeString(req.body.enteredOtp);

    if (!kioskId || !enteredOtp) {
      return res.status(400).json({ error: 'kioskId and enteredOtp are required' });
    }

    const result = await verifyKioskOtp(kioskId, enteredOtp);

    if (result.success && result.jobId) {
      const job = await getPrintJobById(result.jobId);
      broadcastSse('OTP_VERIFIED', {
        jobId: result.jobId,
        kioskId,
        job,
      });
      return res.json({
        success: true,
        message: result.message,
        job,
      });
    }

    res.status(400).json({
      success: false,
      message: result.message,
      attemptsLeft: result.attemptsLeft,
      expired: result.expired,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// 7. Payment Confirmation
app.post('/api/jobs/:id/pay', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const { method = 'CASH', authorizedBy = 'OPERATOR_DESK', referenceId } = req.body;

    const paidJob = await confirmJobPayment(
      jobId,
      method as PaymentMethod,
      authorizedBy,
      referenceId ? sanitizeString(referenceId) : undefined
    );

    broadcastSse('PAYMENT_CONFIRMED', {
      jobId,
      amount: paidJob.totalPrice,
      method,
    });

    await printerService.enqueueJob(jobId);

    res.json({
      success: true,
      job: paidJob,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// 8. Hardware Telemetry & Status Reporting
app.post('/api/printers/status', async (req, res) => {
  try {
    const { kioskId = 'KSK-001', printerStatus, reason, paperA4Level, paperA3Level, tonerLevel } = req.body;
    if (!printerStatus) {
      return res.status(400).json({ error: 'printerStatus is required' });
    }

    await printerService.setPrinterStatus(kioskId, printerStatus as PrinterStatus, reason);

    if (paperA4Level !== undefined || tonerLevel !== undefined) {
      const printers = await getPrinters();
      const current = printers.find((p) => p.kioskId === kioskId) || printers[0];
      if (current) {
        await updatePrinterSupplyLevels(
          current.id,
          paperA4Level ?? current.paperA4Level,
          paperA3Level ?? current.paperA3Level,
          tonerLevel ?? current.tonerLevel,
          printerStatus as PrinterStatus
        );
      }
    }

    res.json({ success: true, kioskId, printerStatus });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update printer status' });
  }
});

app.post('/api/printers/heartbeat', async (req, res) => {
  try {
    const { kioskId = 'KSK-001', printerStatus = 'READY' } = req.body;
    await printerService.setPrinterStatus(kioskId, printerStatus as PrinterStatus);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// 9. AI Gemini Multilingual Voice Guide
app.post('/api/ai/voice-guide', aiVoiceRateLimiter, async (req: Request, res: Response) => {
  try {
    const { userQuery, language = 'en', currentStep = 'HOME', printerStatus = 'READY', kioskId = 'KSK-001' } = req.body;

    if (!userQuery) {
      return res.status(400).json({ error: 'userQuery is required' });
    }

    const guidance = await getGeminiVoiceGuidance({
      userQuery: sanitizeString(userQuery),
      language: sanitizeString(language),
      currentStep: sanitizeString(currentStep),
      printerStatus: sanitizeString(printerStatus),
      kioskId: sanitizeString(kioskId),
    });

    res.json(guidance);
  } catch (err: any) {
    console.error('Error in /api/ai/voice-guide:', err);
    res.status(500).json({
      replyText: 'Please ask the desk operator or follow on-screen instructions.',
      language: req.body.language || 'en',
    });
  }
});

// 10. Admin Endpoints
app.get('/api/jobs', async (_req, res) => {
  try {
    const jobs = await getPrintJobs(50);
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getPrintJobById(sanitizeString(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

app.post('/api/jobs/:id/retry', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const { authorizedBy = 'ADMIN' } = req.body;
    await printerService.retryJob(jobId, authorizedBy);
    res.json({ success: true, message: `Job ${jobId} queued for reprint.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retry job' });
  }
});

app.post('/api/jobs/:id/pause', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const { authorizedBy = 'USER_PHONE' } = req.body;
    await printerService.pauseJob(jobId, authorizedBy);
    res.json({ success: true, message: `Job ${jobId} paused.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to pause job' });
  }
});

app.post('/api/jobs/:id/resume', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const { authorizedBy = 'USER_PHONE' } = req.body;
    await printerService.resumeJob(jobId, authorizedBy);
    res.json({ success: true, message: `Job ${jobId} resumed.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to resume job' });
  }
});

app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const { authorizedBy = 'USER_PHONE' } = req.body;
    await printerService.cancelJob(jobId, authorizedBy);
    res.json({ success: true, message: `Job ${jobId} cancelled.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// Touchless authentication handshake directly from phone (no touching kiosk required)
app.post('/api/jobs/:id/touchless-auth', async (req, res) => {
  try {
    const jobId = sanitizeString(req.params.id);
    const job = await getPrintJobById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    await updateJobStatus(jobId, 'PAYMENT_PENDING', 'Touchless authenticated via phone', 'USER_PHONE');
    const updatedJob = await getPrintJobById(jobId);

    broadcastSse('OTP_VERIFIED', {
      jobId,
      kioskId: job.kioskId,
      job: updatedJob,
      touchless: true,
    });

    broadcastSse('MOBILE_PROGRESS', {
      sessionId: job.sessionId,
      kioskId: job.kioskId,
      step: 'PAYMENT_PENDING',
      details: {
        jobId,
        totalPrice: job.totalPrice,
        originalFileName: job.originalFileName,
      },
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Touchless handshake confirmed.', job: updatedJob });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to complete touchless authentication' });
  }
});

app.get('/api/pricing-rules', async (_req, res) => {
  try {
    const rules = await getPricingRules();
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pricing rules' });
  }
});

app.put('/api/pricing-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { pricePerPage, isActive } = req.body;
    await updatePricingRule(id, Number(pricePerPage), Boolean(isActive));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update pricing rule' });
  }
});

app.get('/api/printers/hardware', async (_req, res) => {
  try {
    const list = await getPrinters();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch printers' });
  }
});

app.post('/api/printers/detect-host', async (_req, res) => {
  try {
    const detected = await printerService.detectHostPrinters();
    res.json(detected);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to detect printers' });
  }
});

app.get('/api/audit-logs', async (_req, res) => {
  try {
    const logs = await getAuditLogs(100);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export { app, server };
