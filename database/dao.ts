import { db } from './index.ts';
import {
  administratorAccounts,
  auditLogs,
  jobEvents,
  kiosks,
  otpVerifications,
  payments,
  pricingRules,
  printJobs,
  printers,
  sessions,
  users,
} from './schema.ts';
import { desc, eq, sql } from 'drizzle-orm';
import { JobStatus, PaymentMethod, PrinterStatus } from '../src/types/kiosk.ts';

// Audit Logger Helper
export async function logAuditEvent(
  kioskId: string | null,
  jobId: string | null,
  action: string,
  performedBy: string,
  metadata?: Record<string, any>
) {
  try {
    await db.insert(auditLogs).values({
      kioskId,
      jobId,
      action,
      performedBy,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}

// Job Events Helper
export async function recordJobEvent(
  jobId: string,
  eventType: string,
  status: JobStatus,
  details?: string,
  actor: string = 'SYSTEM'
) {
  try {
    await db.insert(jobEvents).values({
      jobId,
      eventType,
      status,
      details,
      actor,
    });
  } catch (err) {
    console.error('Failed to record job event:', err);
  }
}

// Kiosks
export async function getKiosks() {
  try {
    return await db.select().from(kiosks);
  } catch (error) {
    console.error('Database query failed for getKiosks:', error);
    throw new Error('Could not retrieve kiosks.', { cause: error });
  }
}

export async function getKioskById(kioskId: string) {
  try {
    const list = await db.select().from(kiosks).where(eq(kiosks.id, kioskId)).limit(1);
    return list[0] || null;
  } catch (error) {
    console.error('Database query failed for getKioskById:', error);
    throw new Error(`Could not retrieve kiosk ${kioskId}.`, { cause: error });
  }
}

export async function updateKioskPrinterStatus(
  kioskId: string,
  printerStatus: PrinterStatus,
  details?: string
) {
  try {
    const isAccepting =
      printerStatus === 'READY' ||
      printerStatus === 'PRINTING' ||
      printerStatus === 'LOW_TONER';

    await db
      .update(kiosks)
      .set({
        printerStatus,
        isAcceptingJobs: isAccepting,
        lastHeartbeat: new Date(),
      })
      .where(eq(kiosks.id, kioskId));

    await logAuditEvent(kioskId, null, 'PRINTER_STATUS_REPORTED', 'PRINTER_SERVICE', {
      status: printerStatus,
      isAcceptingJobs: isAccepting,
      details,
    });
  } catch (error) {
    console.error('Failed to update kiosk printer status:', error);
    throw new Error('Could not update kiosk printer status.', { cause: error });
  }
}

export async function updateKioskHeartbeat(kioskId: string, currentJobId?: string | null) {
  try {
    await db
      .update(kiosks)
      .set({
        lastHeartbeat: new Date(),
        currentJobId: currentJobId !== undefined ? currentJobId : undefined,
      })
      .where(eq(kiosks.id, kioskId));
  } catch (error) {
    console.error('Failed to update kiosk heartbeat:', error);
    throw new Error('Could not update kiosk heartbeat.', { cause: error });
  }
}

// Printers
export async function getPrinters() {
  try {
    return await db.select().from(printers);
  } catch (error) {
    console.error('Database query failed for getPrinters:', error);
    throw new Error('Could not retrieve printers.', { cause: error });
  }
}

export async function getPrinterByKioskId(kioskId: string) {
  try {
    const list = await db.select().from(printers).where(eq(printers.kioskId, kioskId)).limit(1);
    return list[0] || null;
  } catch (error) {
    console.error('Database query failed for getPrinterByKioskId:', error);
    throw new Error(`Could not retrieve printer for kiosk ${kioskId}.`, { cause: error });
  }
}

export async function updatePrinterSupplyLevels(
  printerId: number,
  paperA4Level: number,
  paperA3Level: number,
  tonerLevel: number,
  status: PrinterStatus
) {
  try {
    await db
      .update(printers)
      .set({
        paperA4Level,
        paperA3Level,
        tonerLevel,
        status,
        updatedAt: new Date(),
      })
      .where(eq(printers.id, printerId));
  } catch (error) {
    console.error('Failed to update printer supplies:', error);
    throw new Error('Could not update printer supplies.', { cause: error });
  }
}

// Pricing Rules
export async function getPricingRules() {
  try {
    return await db.select().from(pricingRules).orderBy(pricingRules.id);
  } catch (error) {
    console.error('Database query failed for getPricingRules:', error);
    throw new Error('Could not retrieve pricing rules.', { cause: error });
  }
}

export async function updatePricingRule(
  id: number,
  pricePerPage: number,
  isActive: boolean
) {
  try {
    await db
      .update(pricingRules)
      .set({
        pricePerPage,
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(pricingRules.id, id));
    await logAuditEvent(null, null, 'PRICING_UPDATED', 'ADMIN', { ruleId: id, pricePerPage, isActive });
  } catch (error) {
    console.error('Database update failed for updatePricingRule:', error);
    throw new Error('Could not update pricing rule.', { cause: error });
  }
}

// Sessions
export async function createSession(sessionId: string, kioskId: string, durationMinutes = 10) {
  try {
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const [newSession] = await db
      .insert(sessions)
      .values({
        id: sessionId,
        kioskId,
        status: 'ACTIVE',
        expiresAt,
      })
      .returning();
    return newSession;
  } catch (error) {
    console.error('Database insert failed for createSession:', error);
    throw new Error('Could not create kiosk session.', { cause: error });
  }
}

export async function getSessionById(sessionId: string) {
  try {
    const list = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return list[0] || null;
  } catch (error) {
    console.error('Database query failed for getSessionById:', error);
    throw new Error('Could not retrieve session.', { cause: error });
  }
}

// Users
export async function getOrCreateCustomer(fullName: string, mobileNumber: string, email?: string) {
  try {
    const sanitizedPhone = mobileNumber.trim().replace(/\s+/g, '');
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.mobileNumber, sanitizedPhone))
      .limit(1);

    if (existing.length > 0) {
      const u = existing[0];
      await db
        .update(users)
        .set({
          fullName: fullName.trim() || u.fullName,
          email: email?.trim() || u.email,
          lastUsedAt: new Date(),
        })
        .where(eq(users.id, u.id));
      return u;
    }

    const uid = 'USR-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const [newUser] = await db
      .insert(users)
      .values({
        uid,
        fullName: fullName.trim(),
        mobileNumber: sanitizedPhone,
        email: email?.trim() || null,
        accountStatus: 'ACTIVE',
      })
      .returning();
    return newUser;
  } catch (error) {
    console.error('Database query failed for getOrCreateCustomer:', error);
    throw new Error('Could not record customer information.', { cause: error });
  }
}

// Print Jobs
export async function createPrintJob(jobData: {
  id: string;
  sessionId: string;
  kioskId: string;
  userId: string | null;
  customerName: string;
  customerPhone: string;
  originalFileName: string;
  fileType: string;
  fileSize: number;
  tempFilePath: string | null;
  totalPagesInDoc: number;
  selectedPageRange: string;
  pagesToPrintCount: number;
  paperSize: string;
  colorMode: string;
  isDuplex: boolean;
  orientation: string;
  copies: number;
  unitPrice: number;
  totalPrice: number;
}) {
  try {
    const [job] = await db
      .insert(printJobs)
      .values({
        ...jobData,
        status: 'CONFIGURED',
        paymentStatus: 'PENDING',
        paymentMethod: 'CASH',
        isDocumentDeleted: false,
      })
      .returning();

    await recordJobEvent(job.id, 'JOB_CREATED', 'CONFIGURED', `Job created for file ${job.originalFileName}`);
    await logAuditEvent(job.kioskId, job.id, 'JOB_CREATED', 'CUSTOMER', {
      pages: job.pagesToPrintCount,
      copies: job.copies,
      totalPrice: job.totalPrice,
    });

    return job;
  } catch (error) {
    console.error('Database insert failed for createPrintJob:', error);
    throw new Error('Could not create print job.', { cause: error });
  }
}

export async function getPrintJobById(jobId: string) {
  try {
    const list = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
    return list[0] || null;
  } catch (error) {
    console.error('Database query failed for getPrintJobById:', error);
    throw new Error('Could not retrieve print job.', { cause: error });
  }
}

export async function getPrintJobs(limit = 50) {
  try {
    return await db.select().from(printJobs).orderBy(desc(printJobs.createdAt)).limit(limit);
  } catch (error) {
    console.error('Database query failed for getPrintJobs:', error);
    throw new Error('Could not retrieve print jobs.', { cause: error });
  }
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  errorMessage?: string | null,
  actor: string = 'SYSTEM'
) {
  try {
    const updates: any = {
      status,
      errorMessage: errorMessage ?? null,
    };
    if (status === 'COMPLETED') {
      updates.completedAt = new Date();
    }

    const [updated] = await db
      .update(printJobs)
      .set(updates)
      .where(eq(printJobs.id, jobId))
      .returning();

    await recordJobEvent(jobId, `STATUS_CHANGED_${status}`, status, errorMessage ?? undefined, actor);
    return updated;
  } catch (error) {
    console.error('Database update failed for updateJobStatus:', error);
    throw new Error(`Could not update job status to ${status}.`, { cause: error });
  }
}

// Payment Confirmation
export async function confirmJobPayment(
  jobId: string,
  method: PaymentMethod = 'CASH',
  authorizedBy: string = 'OPERATOR_DESK',
  referenceId?: string
) {
  try {
    const job = await getPrintJobById(jobId);
    if (!job) throw new Error('Job not found');

    await db.insert(payments).values({
      jobId,
      amount: job.totalPrice,
      method,
      status: 'PAID',
      referenceId: referenceId || `TXN-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
      authorizedBy,
      paidAt: new Date(),
    });

    const [updatedJob] = await db
      .update(printJobs)
      .set({
        paymentStatus: 'PAID',
        paymentMethod: method,
        status: 'PAID',
      })
      .where(eq(printJobs.id, jobId))
      .returning();

    if (job.userId) {
      await db
        .update(users)
        .set({
          totalJobs: sql`${users.totalJobs} + 1`,
          totalAmountSpent: sql`${users.totalAmountSpent} + ${job.totalPrice}`,
          lastUsedAt: new Date(),
        })
        .where(eq(users.uid, job.userId));
    }

    await recordJobEvent(jobId, 'PAYMENT_MARKED_PAID', 'PAID', `Paid ₹${job.totalPrice} via ${method}`, authorizedBy);
    await logAuditEvent(job.kioskId, jobId, 'PAYMENT_MARKED_PAID', authorizedBy, {
      amount: job.totalPrice,
      method,
    });

    return updatedJob;
  } catch (error) {
    console.error('Failed to confirm job payment:', error);
    throw new Error('Could not confirm payment for job.', { cause: error });
  }
}

// Mark Document as Deleted (Privacy Purge)
export async function markDocumentDeleted(jobId: string) {
  try {
    await db
      .update(printJobs)
      .set({
        tempFilePath: null,
        isDocumentDeleted: true,
        documentDeletedAt: new Date(),
      })
      .where(eq(printJobs.id, jobId));

    await recordJobEvent(jobId, 'DOCUMENT_DELETED', 'COMPLETED', 'Temporary document binary securely wiped');
    await logAuditEvent(null, jobId, 'DOCUMENT_DELETED', 'AUTO_CLEANUP_WORKER');
  } catch (error) {
    console.error('Failed to mark document deleted:', error);
  }
}

// Audit Logs Query
export async function getAuditLogs(limit = 100) {
  try {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(limit);
  } catch (error) {
    console.error('Database query failed for getAuditLogs:', error);
    throw new Error('Could not retrieve audit logs.', { cause: error });
  }
}

// Admin Accounts
export async function getAdminAccounts() {
  try {
    return await db.select().from(administratorAccounts);
  } catch (error) {
    console.error('Database query failed for getAdminAccounts:', error);
    throw new Error('Could not retrieve administrator accounts.', { cause: error });
  }
}
