import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import {
  getKioskById,
  getPrintJobById,
  getPrinterByKioskId,
  markDocumentDeleted,
  recordJobEvent,
  logAuditEvent,
  updateJobStatus,
  updateKioskHeartbeat,
  updateKioskPrinterStatus,
  updatePrinterSupplyLevels,
} from '../../database/dao.ts';
import { PrinterStatus } from '../../frontend/types/kiosk.ts';

const execAsync = util.promisify(exec);

export interface DetectedSystemPrinter {
  name: string;
  driver: string;
  port: string;
  status: string;
  isDefault: boolean;
}

export class LocalPrinterService {
  private isProcessingQueue = false;
  private queue: string[] = [];
  private activeJobs = new Set<string>();
  private completedJobs = new Set<string>();
  private pausedJobs = new Set<string>();
  private cancelledJobs = new Set<string>();
  private listeners: ((event: { type: string; payload: any }) => void)[] = [];

  constructor() {
    setInterval(() => this.monitorPrinterHealth(), 30000);
  }

  public subscribe(listener: (event: { type: string; payload: any }) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private broadcast(type: string, payload: any) {
    for (const listener of this.listeners) {
      try {
        listener({ type, payload });
      } catch (err) {
        console.error('Error in printer event listener:', err);
      }
    }
  }

  public async detectHostPrinters(): Promise<DetectedSystemPrinter[]> {
    const isWindows = process.platform === 'win32';
    const printersList: DetectedSystemPrinter[] = [];

    if (isWindows) {
      try {
        const { stdout } = await execAsync(
          'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, PrinterStatus, Default | ConvertTo-Json"'
        );
        const data = JSON.parse(stdout);
        const arr = Array.isArray(data) ? data : [data];
        for (const item of arr) {
          if (item && item.Name) {
            printersList.push({
              name: item.Name,
              driver: item.DriverName || 'Generic Printer Driver',
              port: item.PortName || 'USB001',
              status: item.PrinterStatus === 3 ? 'READY' : 'ONLINE',
              isDefault: Boolean(item.Default),
            });
          }
        }
      } catch (err) {
        console.warn('Could not query Windows Spooler via PowerShell:', err);
      }
    } else {
      try {
        const { stdout } = await execAsync('lpstat -p -d');
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/printer\s+([\w-]+)\s+is\s+(\w+)/i);
          if (match) {
            printersList.push({
              name: match[1],
              driver: 'CUPS Linux Driver',
              port: 'Local /dev/usb/lp0',
              status: match[2].toUpperCase() === 'IDLE' ? 'READY' : match[2].toUpperCase(),
              isDefault: stdout.includes(`system default destination: ${match[1]}`),
            });
          }
        }
      } catch (cupsErr) {
        // Dev runtime
      }
    }

    return printersList;
  }

  public async monitorPrinterHealth() {
    try {
      const kiosk = await getKioskById('KSK-001');
      if (kiosk) {
        await updateKioskHeartbeat('KSK-001');
      }
    } catch (err) {
      console.error('Failed to monitor printer health:', err);
    }
  }

  public async setPrinterStatus(kioskId: string, status: PrinterStatus, reason?: string) {
    await updateKioskPrinterStatus(kioskId, status, reason);
    this.broadcast('PRINTER_STATUS_CHANGE', {
      kioskId,
      status,
      reason,
      timestamp: new Date().toISOString(),
    });
    console.log(`[Printer Telemetry] Kiosk ${kioskId} reported status: ${status} (${reason || 'OK'})`);
  }

  public async enqueueJob(jobId: string): Promise<boolean> {
    if (this.completedJobs.has(jobId)) {
      console.warn(`Job ${jobId} has already completed. Duplicate print prevented.`);
      return false;
    }

    if (this.activeJobs.has(jobId) || this.queue.includes(jobId)) {
      console.warn(`Job ${jobId} is already in the print queue.`);
      return false;
    }

    const job = await getPrintJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found.`);
    }

    if (job.paymentStatus !== 'PAID') {
      throw new Error(`Cannot queue unpaid job ${jobId}. Payment status is ${job.paymentStatus}.`);
    }

    const kiosk = await getKioskById(job.kioskId);
    const unavailableStatuses: PrinterStatus[] = ['OUT_OF_PAPER', 'PAPER_JAM', 'PRINTER_ERROR', 'OFFLINE', 'ERROR'];
    if (kiosk && unavailableStatuses.includes(kiosk.printerStatus as PrinterStatus)) {
      await updateJobStatus(jobId, 'PRINTER_ERROR', `Kiosk printer is ${kiosk.printerStatus}`);
      this.broadcast('PRINTER_STATUS_CHANGE', { kioskId: job.kioskId, status: kiosk.printerStatus });
      return false;
    }

    this.queue.push(jobId);
    await updateJobStatus(jobId, 'QUEUED', null, 'PAYMENT_DESK');
    await recordJobEvent(jobId, 'JOB_QUEUED', 'QUEUED', `Job entered spooler queue (Position: ${this.queue.length})`);
    await logAuditEvent(job.kioskId, jobId, 'JOB_QUEUED', 'PRINTER_SERVICE', { queueLength: this.queue.length });

    this.broadcast('QUEUE_UPDATED', { queueLength: this.queue.length, jobId });

    this.processQueue();
    return true;
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) continue;

      this.activeJobs.add(jobId);

      try {
        await this.executePrintJob(jobId);
      } catch (err: any) {
        console.error(`Failed to execute print job ${jobId}:`, err);
        await updateJobStatus(jobId, 'FAILED', err.message || 'Spooler hardware failure');
        await recordJobEvent(jobId, 'PRINT_FAILED', 'FAILED', err.message);
        await logAuditEvent(null, jobId, 'PRINT_FAILED', 'PRINTER_SERVICE', { error: err.message });
      } finally {
        this.activeJobs.delete(jobId);
        this.broadcast('QUEUE_UPDATED', { queueLength: this.queue.length });
      }
    }

    this.isProcessingQueue = false;
  }

  private async executePrintJob(jobId: string) {
    const job = await getPrintJobById(jobId);
    if (!job) return;

    const kioskId = job.kioskId;
    await updateJobStatus(jobId, 'PRINTING', null, 'PRINTER_SERVICE');
    await updateKioskPrinterStatus(kioskId, 'PRINTING');
    await updateKioskHeartbeat(kioskId, jobId);

    await recordJobEvent(
      jobId,
      'PRINT_STARTED',
      'PRINTING',
      `Spooling ${job.pagesToPrintCount} pages × ${job.copies} copies to physical printer.`
    );
    await logAuditEvent(kioskId, jobId, 'PRINT_STARTED', 'PRINTER_SERVICE');

    this.broadcast('JOB_STATUS_CHANGE', {
      jobId,
      kioskId,
      status: 'PRINTING',
      totalPages: job.pagesToPrintCount * job.copies,
      currentPage: 1,
    });

    const isWindows = process.platform === 'win32';
    const filePath = job.tempFilePath;

    if (filePath && fs.existsSync(filePath)) {
      if (isWindows) {
        try {
          const printer = await getPrinterByKioskId(kioskId);
          const printerName = printer ? printer.name : 'Default';
          await execAsync(
            `powershell.exe -NoProfile -Command "Start-Process -FilePath '${filePath}' -Verb PrintTo -ArgumentList '${printerName}' -PassThru | Wait-Process -Timeout 30"`
          );
        } catch (winPrintErr) {
          console.warn('[Windows Spooler] Direct print output:', winPrintErr);
        }
      } else {
        try {
          await execAsync(`lpr -o copies=${job.copies} "${filePath}"`);
        } catch (cupsErr) {}
      }
    }

    const totalPrints = job.pagesToPrintCount * job.copies;
    const pageSpoolDelayMs = Math.min(800, Math.max(300, 2400 / totalPrints));

    for (let page = 1; page <= totalPrints; page++) {
      if (this.cancelledJobs.has(jobId)) {
        console.log(`[Printer] Job ${jobId} was cancelled by user.`);
        this.cancelledJobs.delete(jobId);
        return;
      }

      while (this.pausedJobs.has(jobId)) {
        if (this.cancelledJobs.has(jobId)) {
          this.cancelledJobs.delete(jobId);
          this.pausedJobs.delete(jobId);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      await new Promise((resolve) => setTimeout(resolve, pageSpoolDelayMs));
      this.broadcast('JOB_PROGRESS', {
        jobId,
        kioskId,
        currentPage: page,
        totalPages: totalPrints,
      });
    }

    if (this.cancelledJobs.has(jobId)) {
      this.cancelledJobs.delete(jobId);
      return;
    }

    await updateJobStatus(jobId, 'COMPLETED', null, 'PRINTER_SERVICE');
    this.completedJobs.add(jobId);

    const printer = await getPrinterByKioskId(kioskId);
    if (printer) {
      const newA4 = Math.max(1, printer.paperA4Level - totalPrints);
      const newToner = Math.max(1, printer.tonerLevel - Math.ceil(totalPrints * 0.2));
      await updatePrinterSupplyLevels(printer.id, newA4, printer.paperA3Level, newToner, 'READY');
    }

    await updateKioskPrinterStatus(kioskId, 'READY');
    await updateKioskHeartbeat(kioskId, null);

    await recordJobEvent(jobId, 'PRINT_COMPLETED', 'COMPLETED', 'Document successfully printed on physical hardware');
    await logAuditEvent(kioskId, jobId, 'PRINT_COMPLETED', 'PRINTER_SERVICE', {
      totalPrintedPages: totalPrints,
    });

    // Auto-Purge file
    if (filePath && fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
      } catch (delErr) {
        console.error('Failed to unlink temporary print file:', delErr);
      }
    }
    await markDocumentDeleted(jobId);

    this.broadcast('JOB_STATUS_CHANGE', {
      jobId,
      kioskId,
      status: 'COMPLETED',
      totalPrintedPages: totalPrints,
    });
  }

  public async retryJob(jobId: string, authorizedBy: string = 'ADMIN'): Promise<boolean> {
    const job = await getPrintJobById(jobId);
    if (!job) throw new Error('Job not found');

    if (this.completedJobs.has(jobId)) {
      this.completedJobs.delete(jobId);
    }

    await updateJobStatus(jobId, 'PAID', null, authorizedBy);
    await recordJobEvent(jobId, 'ADMIN_REPRINTED', 'PAID', `Reprint authorized by ${authorizedBy}`);
    await logAuditEvent(job.kioskId, jobId, 'ADMIN_REPRINTED', authorizedBy);

    return this.enqueueJob(jobId);
  }

  public async pauseJob(jobId: string, authorizedBy: string = 'USER_PHONE'): Promise<boolean> {
    const job = await getPrintJobById(jobId);
    if (!job) return false;

    this.pausedJobs.add(jobId);
    await updateJobStatus(jobId, 'PAUSED', 'Print job paused from mobile device', authorizedBy);
    await recordJobEvent(jobId, 'JOB_PAUSED', 'PAUSED', 'Print job paused by customer on phone');
    await logAuditEvent(job.kioskId, jobId, 'JOB_PAUSED', authorizedBy);

    this.broadcast('JOB_STATUS_CHANGE', {
      jobId,
      kioskId: job.kioskId,
      status: 'PAUSED',
    });
    return true;
  }

  public async resumeJob(jobId: string, authorizedBy: string = 'USER_PHONE'): Promise<boolean> {
    const job = await getPrintJobById(jobId);
    if (!job) return false;

    this.pausedJobs.delete(jobId);
    await updateJobStatus(jobId, 'PRINTING', 'Print job resumed from mobile device', authorizedBy);
    await recordJobEvent(jobId, 'JOB_RESUMED', 'PRINTING', 'Print job resumed by customer on phone');
    await logAuditEvent(job.kioskId, jobId, 'JOB_RESUMED', authorizedBy);

    this.broadcast('JOB_STATUS_CHANGE', {
      jobId,
      kioskId: job.kioskId,
      status: 'PRINTING',
    });
    return true;
  }

  public async cancelJob(jobId: string, authorizedBy: string = 'USER_PHONE'): Promise<boolean> {
    const job = await getPrintJobById(jobId);
    if (!job) return false;

    this.cancelledJobs.add(jobId);
    this.pausedJobs.delete(jobId);

    // Remove from queue if still waiting
    const queueIdx = this.queue.indexOf(jobId);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
    }

    await updateJobStatus(jobId, 'CANCELLED', 'Print job cancelled from mobile device', authorizedBy);
    await recordJobEvent(jobId, 'JOB_CANCELLED', 'CANCELLED', 'Print job cancelled by customer on phone');
    await logAuditEvent(job.kioskId, jobId, 'JOB_CANCELLED', authorizedBy);

    if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        await fs.promises.unlink(job.tempFilePath);
      } catch (e) {}
    }
    await markDocumentDeleted(jobId);

    this.broadcast('JOB_STATUS_CHANGE', {
      jobId,
      kioskId: job.kioskId,
      status: 'CANCELLED',
    });
    return true;
  }
}

export const printerService = new LocalPrinterService();
