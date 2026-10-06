import fs from 'fs';
import path from 'path';
import { conversionService } from './conversionService.ts';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'temp_uploads');

// Ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export interface DocumentAnalysisResult {
  valid: boolean;
  pageCount: number;
  originalFileName: string;
  fileSize: number;
  fileType: string;
  tempFilePath: string; // The standardized print-ready PDF path
  rawUploadPath?: string; // The original uploaded raw binary path
  error?: string;
}

export async function analyzeUploadedDocument(
  fileBuffer: Buffer,
  originalFileName: string,
  _mimetype: string
): Promise<DocumentAnalysisResult> {
  const ext = path.extname(originalFileName).toLowerCase().replace('.', '');
  const supportedExtensions = ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'];

  if (!supportedExtensions.includes(ext)) {
    return {
      valid: false,
      pageCount: 0,
      originalFileName,
      fileSize: fileBuffer.length,
      fileType: ext,
      tempFilePath: '',
      error: `Unsupported format ".${ext}". Supported: PDF, DOCX, PPTX, JPG, PNG.`,
    };
  }

  // Save the original raw uploaded file to temporary secure storage
  const rawBaseName = `raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const rawUploadPath = path.join(UPLOAD_DIR, rawBaseName);
  await fs.promises.writeFile(rawUploadPath, fileBuffer);

  // Execute standardized conversion to print-ready PDF
  const conversion = await conversionService.convertToPrintReadyPdf(
    fileBuffer,
    originalFileName
  );

  if (!conversion.success) {
    // If conversion failed, purge raw upload and report error
    if (fs.existsSync(rawUploadPath)) {
      try {
        await fs.promises.unlink(rawUploadPath);
      } catch (_) {}
    }

    return {
      valid: false,
      pageCount: 0,
      originalFileName,
      fileSize: fileBuffer.length,
      fileType: ext.toUpperCase(),
      tempFilePath: '',
      error: conversion.error || 'Document conversion to standardized print format failed.',
    };
  }

  return {
    valid: true,
    pageCount: conversion.totalPages,
    originalFileName,
    fileSize: conversion.fileSize,
    fileType: ext.toUpperCase(),
    tempFilePath: conversion.convertedPdfPath, // The print spooler will receive the standardized PDF
    rawUploadPath,
  };
}
