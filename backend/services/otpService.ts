import crypto from 'crypto';
import { db } from '../../database/index.ts';
import { otpVerifications, sessions } from '../../database/schema.ts';
import { eq, and } from 'drizzle-orm';
import { logAuditEvent, recordJobEvent, updateJobStatus } from '../../database/dao.ts';
import { timingSafeCompare } from '../middleware/security.ts';

const OTP_TTL_SECONDS = 120;
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

  const otpNumber = crypto.randomInt(100000, 999999).toString();
  const hashedOtp = hashOtp(otpNumber);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await db
    .delete(otpVerifications)
    .where(eq(otpVerifications.jobId, jobId));

  await db
    .insert(otpVerifications)
    .values({
      jobId,
      sessionId,
      kioskId,
      hashedOtp,
      displayOtp: otpNumber,
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      isVerified: false,
    });

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

  const targetHash = hashOtp(cleanOtp);
  const now = new Date();

  // Find candidate using timingSafeCompare to prevent timing attacks
  const matchedRecord = records.find((r) => timingSafeCompare(r.hashedOtp, targetHash));

  if (!matchedRecord) {
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

  if (now > matchedRecord.expiresAt) {
    await updateJobStatus(matchedRecord.jobId, 'EXPIRED', 'OTP expired');
    await logAuditEvent(kioskId, matchedRecord.jobId, 'OTP_EXPIRED', 'KIOSK');
    return {
      success: false,
      message: 'OTP has expired. Please generate a new OTP from your mobile screen.',
      expired: true,
    };
  }

  if (matchedRecord.attempts >= matchedRecord.maxAttempts) {
    return {
      success: false,
      message: 'This OTP has exceeded maximum attempts.',
    };
  }

  await db
    .update(otpVerifications)
    .set({
      isVerified: true,
      verifiedAt: now,
    })
    .where(eq(otpVerifications.id, matchedRecord.id));

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
