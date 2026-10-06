import fs from 'fs';
import path from 'path';
import { UPLOAD_DIR } from './fileProcessor.ts';
import { db } from '../db/index.ts';
import { printJobs } from '../db/schema.ts';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { logAuditEvent, markDocumentDeleted } from '../db/dao.ts';

const MAX_FILE_AGE_MS = 15 * 60 * 1000; // 15 minutes max retention

export function startCleanupWorker() {
  // Run sweep every 60 seconds
  setInterval(async () => {
    try {
      await sweepOrphanedFiles();
    } catch (err) {
      console.error('Error during cleanup sweep:', err);
    }
  }, 60000);
}

async function sweepOrphanedFiles() {
  if (!fs.existsSync(UPLOAD_DIR)) return;

  const files = await fs.promises.readdir(UPLOAD_DIR);
  const now = Date.now();

  for (const file of files) {
    const fullPath = path.join(UPLOAD_DIR, file);
    try {
      const stats = await fs.promises.stat(fullPath);
      const ageMs = now - stats.mtimeMs;

      // Delete if file is older than 15 minutes
      if (ageMs > MAX_FILE_AGE_MS) {
        await fs.promises.unlink(fullPath);
        console.log(`[Privacy Purge] Expired file unlinked: ${file}`);
      }
    } catch (e) {
      // Ignore stat error if already deleted
    }
  }

  // Check database for completed or cancelled jobs whose files haven't been marked deleted
  const unpurged = await db
    .select({ id: printJobs.id, tempFilePath: printJobs.tempFilePath })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.isDocumentDeleted, false),
        isNotNull(printJobs.tempFilePath)
      )
    );

  for (const job of unpurged) {
    if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        await fs.promises.unlink(job.tempFilePath);
        console.log(`[Privacy Purge] Unlinked file for job ${job.id}`);
      } catch (err) {
        // file could already be gone
      }
    }
    await markDocumentDeleted(job.id);
  }
}
