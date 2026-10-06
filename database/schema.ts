import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Unique identifier (phone or generated auth id)
  fullName: text('full_name').notNull(),
  mobileNumber: text('mobile_number').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  totalJobs: integer('total_jobs').default(0).notNull(),
  totalAmountSpent: integer('total_amount_spent').default(0).notNull(), // In INR ₹
  accountStatus: text('account_status').default('ACTIVE').notNull(),
});

export const kiosks = pgTable('kiosks', {
  id: text('id').primaryKey(), // e.g. 'KSK-001'
  name: text('name').notNull(),
  location: text('location').notNull(),
  status: text('status').default('ONLINE').notNull(), // 'ONLINE', 'OFFLINE', 'MAINTENANCE'
  printerName: text('printer_name').notNull(),
  printerStatus: text('printer_status').default('READY').notNull(), // 'READY', 'PRINTING', 'OUT_OF_PAPER', 'PAPER_JAM', 'LOW_TONER', 'PRINTER_ERROR', 'OFFLINE'
  currentJobId: text('current_job_id'),
  lastHeartbeat: timestamp('last_heartbeat').defaultNow().notNull(),
  softwareVersion: text('software_version').default('v1.4.2').notNull(),
  isAcceptingJobs: boolean('is_accepting_jobs').default(true).notNull(),
});

export const printers = pgTable('printers', {
  id: serial('id').primaryKey(),
  kioskId: text('kiosk_id').references(() => kiosks.id).notNull(),
  name: text('name').notNull(),
  driverName: text('driver_name').default('HP LaserJet Pro P1102w / Windows Universal').notNull(),
  portName: text('port_name').default('USB001 / WSD-PrintSpooler').notNull(),
  status: text('status').default('READY').notNull(),
  paperA4Level: integer('paper_a4_level').default(85).notNull(), // Percentage
  paperA3Level: integer('paper_a3_level').default(60).notNull(),
  tonerLevel: integer('toner_level').default(92).notNull(), // Percentage
  isColor: boolean('is_color').default(true).notNull(),
  isDuplex: boolean('is_duplex').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const pricingRules = pgTable('pricing_rules', {
  id: serial('id').primaryKey(),
  paperSize: text('paper_size').notNull(), // 'A4', 'A3'
  colorMode: text('color_mode').notNull(), // 'BW', 'COLOR'
  isDuplex: boolean('is_duplex').default(false).notNull(),
  pricePerPage: integer('price_per_page').notNull(), // in ₹ e.g. 2, 10, 5, 20
  isActive: boolean('is_active').default(true).notNull(),
  effectiveDate: timestamp('effective_date').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // 'SES-XXXX'
  kioskId: text('kiosk_id').references(() => kiosks.id).notNull(),
  userId: text('user_id'),
  status: text('status').default('ACTIVE').notNull(), // 'ACTIVE', 'AUTHENTICATED', 'EXPIRED', 'COMPLETED', 'CANCELLED'
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const printJobs = pgTable('print_jobs', {
  id: text('id').primaryKey(), // 'GG-10021'
  sessionId: text('session_id').references(() => sessions.id).notNull(),
  kioskId: text('kiosk_id').references(() => kiosks.id).notNull(),
  userId: text('user_id'),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  originalFileName: text('original_file_name').notNull(),
  fileType: text('file_type').notNull(),
  fileSize: integer('file_size').notNull(),
  tempFilePath: text('temp_file_path'), // temporary disk path, purged after print
  totalPagesInDoc: integer('total_pages_in_doc').notNull(),
  selectedPageRange: text('selected_page_range').default('all').notNull(),
  pagesToPrintCount: integer('pages_to_print_count').notNull(),
  paperSize: text('paper_size').default('A4').notNull(),
  colorMode: text('color_mode').default('BW').notNull(),
  isDuplex: boolean('is_duplex').default(false).notNull(),
  orientation: text('orientation').default('portrait').notNull(),
  copies: integer('copies').default(1).notNull(),
  unitPrice: integer('unit_price').notNull(),
  totalPrice: integer('total_price').notNull(),
  paymentStatus: text('payment_status').default('PENDING').notNull(), // 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'
  paymentMethod: text('payment_method').default('CASH').notNull(),
  status: text('status').default('CREATED').notNull(), // CREATED, UPLOADING, UPLOADED, CONFIGURED, OTP_PENDING, AUTHENTICATED, PAYMENT_PENDING, PAID, QUEUED, PRINTING, COMPLETED, CANCELLED, EXPIRED, FAILED, PRINTER_ERROR, CONVERSION_FAILED
  errorMessage: text('error_message'),
  isDocumentDeleted: boolean('is_document_deleted').default(false).notNull(),
  documentDeletedAt: timestamp('document_deleted_at'),
  retries: integer('retries').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const otpVerifications = pgTable('otp_verifications', {
  id: serial('id').primaryKey(),
  jobId: text('job_id').references(() => printJobs.id).notNull(),
  sessionId: text('session_id').references(() => sessions.id).notNull(),
  kioskId: text('kiosk_id').references(() => kiosks.id).notNull(),
  hashedOtp: text('hashed_otp').notNull(),
  displayOtp: text('display_otp').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  jobId: text('job_id').references(() => printJobs.id).notNull(),
  amount: integer('amount').notNull(),
  method: text('method').default('CASH').notNull(),
  status: text('status').default('PENDING').notNull(),
  referenceId: text('reference_id'),
  authorizedBy: text('authorized_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  paidAt: timestamp('paid_at'),
});

export const jobEvents = pgTable('job_events', {
  id: serial('id').primaryKey(),
  jobId: text('job_id').references(() => printJobs.id).notNull(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  details: text('details'),
  actor: text('actor').default('SYSTEM').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  kioskId: text('kiosk_id'),
  jobId: text('job_id'),
  action: text('action').notNull(),
  performedBy: text('performed_by').notNull(),
  metadata: text('metadata'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const administratorAccounts = pgTable('administrator_accounts', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  fullName: text('full_name').notNull(),
  role: text('role').default('operator').notNull(),
  pinCode: text('pin_code').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
