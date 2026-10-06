import fs from 'fs';
import path from 'path';
import { conversionService, UPLOAD_DIR } from './conversionService.ts';

export { UPLOAD_DIR };

export interface DocumentAnalysisResult {
  valid: boolean;
  pageCount: number;
  originalFileName: string;
  fileSize: number;
  fileType: string;
  tempFilePath: string;
  rawUploadPath?: string;
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

  // Execute standardized conversion to print-ready PDF directly
  const conversion = await conversionService.convertToPrintReadyPdf(
    fileBuffer,
    originalFileName
  );

  if (!conversion.success) {
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
    tempFilePath: conversion.convertedPdfPath,
    rawUploadPath: conversion.convertedPdfPath,
  };
}
