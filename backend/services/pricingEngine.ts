import { getPricingRules } from '../../database/dao.ts';
import { ColorMode, PaperSize } from '../../frontend/types/kiosk.ts';

export interface PageRangeResult {
  valid: boolean;
  pageNumbers: number[];
  pagesCount: number;
  error?: string;
}

export function parseAndValidatePageRange(
  rangeInput: string,
  totalPagesInDoc: number
): PageRangeResult {
  const clean = rangeInput.trim().toLowerCase();

  if (!clean || clean === 'all') {
    const allPages = Array.from({ length: totalPagesInDoc }, (_, i) => i + 1);
    return {
      valid: true,
      pageNumbers: allPages,
      pagesCount: totalPagesInDoc,
    };
  }

  const parts = clean.split(',');
  const selectedPages = new Set<number>();

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        return {
          valid: false,
          pageNumbers: [],
          pagesCount: 0,
          error: `Invalid page range "${part}". Must be format e.g. 1-5 with start <= end.`,
        };
      }

      if (end > totalPagesInDoc) {
        return {
          valid: false,
          pageNumbers: [],
          pagesCount: 0,
          error: `Page range ${part} exceeds document total pages (${totalPagesInDoc}).`,
        };
      }

      for (let p = start; p <= end; p++) {
        selectedPages.add(p);
      }
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page) || page < 1) {
        return {
          valid: false,
          pageNumbers: [],
          pagesCount: 0,
          error: `Invalid page number "${part}".`,
        };
      }
      if (page > totalPagesInDoc) {
        return {
          valid: false,
          pageNumbers: [],
          pagesCount: 0,
          error: `Page ${page} exceeds document total pages (${totalPagesInDoc}).`,
        };
      }
      selectedPages.add(page);
    }
  }

  const sortedPages = Array.from(selectedPages).sort((a, b) => a - b);
  if (sortedPages.length === 0) {
    return {
      valid: false,
      pageNumbers: [],
      pagesCount: 0,
      error: 'No valid pages selected.',
    };
  }

  return {
    valid: true,
    pageNumbers: sortedPages,
    pagesCount: sortedPages.length,
  };
}

export interface PriceCalculationResult {
  paperSize: PaperSize;
  colorMode: ColorMode;
  isDuplex: boolean;
  copies: number;
  pagesToPrintCount: number;
  unitPrice: number;
  totalPrints: number;
  totalPrice: number;
  breakdown: string;
}

export async function calculatePrintPrice(params: {
  paperSize: PaperSize;
  colorMode: ColorMode;
  isDuplex: boolean;
  copies: number;
  pagesToPrintCount: number;
}): Promise<PriceCalculationResult> {
  const { paperSize, colorMode, isDuplex, copies, pagesToPrintCount } = params;

  let unitPrice = 2;

  try {
    const rules = await getPricingRules();
    const exactMatch = rules.find(
      (r) =>
        r.isActive &&
        r.paperSize === paperSize &&
        r.colorMode === colorMode &&
        r.isDuplex === isDuplex
    );

    if (exactMatch) {
      unitPrice = exactMatch.pricePerPage;
    } else {
      const partialMatch = rules.find(
        (r) => r.isActive && r.paperSize === paperSize && r.colorMode === colorMode
      );
      if (partialMatch) {
        unitPrice = partialMatch.pricePerPage + (isDuplex ? 1 : 0);
      } else {
        if (paperSize === 'A3') {
          unitPrice = colorMode === 'COLOR' ? 20 : 5;
        } else {
          unitPrice = colorMode === 'COLOR' ? 10 : 2;
        }
        if (isDuplex) unitPrice += 1;
      }
    }
  } catch (err) {
    if (paperSize === 'A3') {
      unitPrice = colorMode === 'COLOR' ? 20 : 5;
    } else {
      unitPrice = colorMode === 'COLOR' ? 10 : 2;
    }
  }

  const safeCopies = Math.max(1, Math.min(99, copies));
  const totalPrints = pagesToPrintCount * safeCopies;
  const totalPrice = unitPrice * totalPrints;

  const breakdown = `${pagesToPrintCount} pages × ${safeCopies} ${
    safeCopies === 1 ? 'copy' : 'copies'
  } = ${totalPrints} prints @ ₹${unitPrice}/page = ₹${totalPrice}`;

  return {
    paperSize,
    colorMode,
    isDuplex,
    copies: safeCopies,
    pagesToPrintCount,
    unitPrice,
    totalPrints,
    totalPrice,
    breakdown,
  };
}
