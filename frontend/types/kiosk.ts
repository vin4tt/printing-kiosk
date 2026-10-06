export type Language = 'en' | 'mr' | 'hi' | 'gu' | 'ta' | 'kn' | 'es';

export type JobStatus =
  | 'CREATED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'CONVERTING'
  | 'CONVERSION_FAILED'
  | 'CONFIGURED'
  | 'OTP_PENDING'
  | 'AUTHENTICATED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'QUEUED'
  | 'PRINTING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'PRINTER_ERROR'
  | 'PAYMENT_FAILED'
  | 'UPLOAD_FAILED'
  | 'OTP_FAILED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'UPI_MANUAL' | 'ONLINE' | 'CARD';
export type PrinterStatus =
  | 'READY'
  | 'PRINTING'
  | 'OUT_OF_PAPER'
  | 'PAPER_JAM'
  | 'LOW_TONER'
  | 'PRINTER_ERROR'
  | 'OFFLINE'
  | 'ERROR';

export type PaperSize = 'A4' | 'A3';
export type ColorMode = 'BW' | 'COLOR';
export type Orientation = 'portrait' | 'landscape' | 'auto';

export interface PricingRule {
  id: number;
  paperSize: string;
  colorMode: string;
  isDuplex: boolean;
  pricePerPage: number;
  isActive: boolean;
  effectiveDate: string;
}

export interface KioskData {
  id: string;
  name: string;
  location: string;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  printerName: string;
  printerStatus: PrinterStatus;
  currentJobId: string | null;
  lastHeartbeat: string;
  softwareVersion: string;
  isAcceptingJobs: boolean;
}

export interface PrinterHardware {
  id: number;
  kioskId: string;
  name: string;
  driverName: string;
  portName: string;
  status: PrinterStatus;
  paperA4Level: number;
  paperA3Level: number;
  tonerLevel: number;
  isColor: boolean;
  isDuplex: boolean;
}

export interface PrintJobData {
  id: string;
  sessionId: string;
  kioskId: string;
  userId: string | null;
  customerName: string;
  customerPhone: string;
  originalFileName: string;
  fileType: string;
  fileSize: number;
  totalPagesInDoc: number;
  selectedPageRange: string;
  pagesToPrintCount: number;
  paperSize: PaperSize;
  colorMode: ColorMode;
  isDuplex: boolean;
  orientation: Orientation;
  copies: number;
  unitPrice: number;
  totalPrice: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  status: JobStatus;
  errorMessage: string | null;
  isDocumentDeleted: boolean;
  retries: number;
  createdAt: string;
  completedAt: string | null;
}

export interface OtpSessionData {
  jobId: string;
  sessionId: string;
  kioskId: string;
  displayOtp: string;
  expiresAt: string;
  remainingSeconds: number;
  attempts: number;
}

export interface AuditLogEntry {
  id: number;
  kioskId: string | null;
  jobId: string | null;
  action: string;
  performedBy: string;
  metadata: string | null;
  timestamp: string;
}
