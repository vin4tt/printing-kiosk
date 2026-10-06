import crypto from 'crypto';
import { db } from '../db/index.ts';
import { otpVerifications, printJobs, sessions } from '../db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { logAuditEvent, recordJobEvent, updateJobStatus } from '../db/dao.ts';

const OTP_TTL_SECONDS = 120; // 2 minutes per prompt specs
const MAX_ATTEMPTS = 3;

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp + 'SMART_PRINT_SALT').digest('hex');
}

export async function generateJobOtp(params: {
  jobId: string;
  sessionId: string;
  kioskId: string;
}) {
  const { jobId, sessionId, kioskId } = params;

  // Generate cryptographically secure 6-digit number
  const otpNumber = crypto.randomInt(100000, 999999).toString();
  const hashedOtp = hashOtp(otpNumber);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  // Invalidate any prior OTP for this job
  await db
    .delete(otpVerifications)
    .where(eq(otpVerifications.jobId, jobId));

  // Insert new record
  const [created] = await db
    .insert(otpVerifications)
    .values({
      jobId,
      sessionId,
      kioskId,
      hashedOtp,
      displayOtp: otpNumber, // Displayed ONLY on customer's phone session
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      isVerified: false,
    })
    .returning();

  // Update job status to OTP_PENDING
  await updateJobStatus(jobId, 'OTP_PENDING', null, 'CUSTOMER');
  await recordJobEvent(jobId, 'OTP_GENERATED', 'OTP_PENDING', 'Secure 6-digit OTP generated for mobile session');
  await logAuditEvent(kioskId, jobId, 'OTP_GENERATED', 'SYSTEM', { expiresAt });

  return {
    otp: otpNumber,
    expiresAt,
    ttlSeconds: OTP_TTL_SECONDS,
  };
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
  jobId?: string;
  attemptsLeft?: number;
  expired?: boolean;
}

export async function verifyKioskOtp(
  kioskId: string,
  enteredOtp: string
): Promise<VerifyOtpResult> {
  const cleanOtp = enteredOtp.trim();
  if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
    return {
      success: false,
      message: 'Please enter a valid 6-digit numeric OTP.',
    };
  }

  // Look for active unverified OTP tied to this kiosk
  const records = await db
    .select()
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.kioskId, kioskId),
        eq(otpVerifications.isVerified, false)
      )
    );

  if (records.length === 0) {
    return {
      success: false,
      message: 'No pending print request found for this kiosk. Please submit a document first.',
    };
  }

  // Find record where OTP matches
  const targetHash = hashOtp(cleanOtp);
  const now = new Date();

  // Find candidate by hash or most recent
  let matchedRecord = records.find((r) => r.hashedOtp === targetHash);

  if (!matchedRecord) {
    // Increment attempts on the most recent pending session
    const latest = records[records.length - 1];
    const newAttempts = latest.attempts + 1;

    await db
      .update(otpVerifications)
      .set({ attempts: newAttempts })
      .where(eq(otpVerifications.id, latest.id));

    const attemptsLeft = Math.max(0, latest.maxAttempts - newAttempts);

    if (attemptsLeft === 0) {
      await updateJobStatus(latest.jobId, 'OTP_FAILED', 'Maximum OTP attempts exceeded');
      await logAuditEvent(kioskId, latest.jobId, 'OTP_MAX_ATTEMPTS_EXCEEDED', 'KIOSK');
      return {
        success: false,
        message: 'Maximum OTP attempts exceeded. Please generate a new print request.',
        attemptsLeft: 0,
      };
    }

    return {
      success: false,
      message: `Incorrect OTP. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} remaining.`,
      attemptsLeft,
    };
  }

  // Check expiration
  if (now > matchedRecord.expiresAt) {
    await updateJobStatus(matchedRecord.jobId, 'EXPIRED', 'OTP expired');
    await logAuditEvent(kioskId, matchedRecord.jobId, 'OTP_EXPIRED', 'KIOSK');
    return {
      success: false,
      message: 'OTP has expired. Please generate a new OTP from your mobile screen.',
      expired: true,
    };
  }

  // Check attempts
  if (matchedRecord.attempts >= matchedRecord.maxAttempts) {
    return {
      success: false,
      message: 'This OTP has exceeded maximum attempts.',
    };
  }

  // Successful verification
  await db
    .update(otpVerifications)
    .set({
      isVerified: true,
      verifiedAt: now,
    })
    .where(eq(otpVerifications.id, matchedRecord.id));

  // Update session & job status to AUTHENTICATED -> PAYMENT_PENDING
  await db
    .update(sessions)
    .set({ status: 'AUTHENTICATED' })
    .where(eq(sessions.id, matchedRecord.sessionId));

  await updateJobStatus(matchedRecord.jobId, 'PAYMENT_PENDING', null, 'KIOSK');
  await recordJobEvent(matchedRecord.jobId, 'OTP_VERIFIED', 'PAYMENT_PENDING', 'Customer authenticated at kiosk terminal', 'KIOSK');
  await logAuditEvent(kioskId, matchedRecord.jobId, 'OTP_VERIFIED', 'KIOSK');

  return {
    success: true,
    message: 'OTP Verified successfully!',
    jobId: matchedRecord.jobId,
  };
}
