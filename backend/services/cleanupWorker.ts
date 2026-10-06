import fs from 'fs';
import path from 'path';
import { UPLOAD_DIR } from './conversionService.ts';
import { db } from '../../database/index.ts';
import { printJobs } from '../../database/schema.ts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { markDocumentDeleted } from '../../database/dao.ts';

const MAX_FILE_AGE_MS = 15 * 60 * 1000;

export function startCleanupWorker() {
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

      if (ageMs > MAX_FILE_AGE_MS) {
        await fs.promises.unlink(fullPath);
        console.log(`[Privacy Purge] Expired file unlinked: ${file}`);
      }
    } catch (e) {
      // Ignored
    }
  }

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
      } catch (err) {}
    }
    await markDocumentDeleted(job.id);
  }
}
