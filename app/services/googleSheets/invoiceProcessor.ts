import { updateCmpInSheets } from "./cmpHandle/cmpCalculate";
import type {
  InvoiceItem as CmpInvoiceItem,
  ProcessingResult,
} from "./cmpHandle/cmpCalculate";

// Re-export InvoiceItem type for external use
export type InvoiceItem = CmpInvoiceItem;

// Extended result type to match the expected format in actions.server.ts
export interface InvoiceProcessingResult extends ProcessingResult {
  ambiguous?: string[];
  report?: string[];
}

export interface InvoiceProcessor {
  processInvoice(
    invoiceItems: InvoiceItem[],
    sheetsService: any
  ): Promise<InvoiceProcessingResult>;
}

class InvoiceProcessorImpl implements InvoiceProcessor {
  constructor(private spreadsheetId: string) {}

  async processInvoice(
    invoiceItems: InvoiceItem[],
    sheetsService: any
  ): Promise<InvoiceProcessingResult> {
    try {
      // Call the existing CMP calculation logic
      const result = await updateCmpInSheets(
        invoiceItems,
        sheetsService,
        0 // totalShippingFee - set to 0 as it should be included in unit_price already
      );

      // Transform result to match expected format
      const extendedResult: InvoiceProcessingResult = {
        ...result,
        ambiguous: [], // Not used in current CMP logic
        report: this.generateReport(result),
      };

      return extendedResult;
    } catch (error) {
      console.error("Invoice processing error:", error);
      throw error;
    }
  }

  private generateReport(result: ProcessingResult): string[] {
    const report: string[] = [];

    report.push(`Processed: ${result.processed} items`);
    report.push(`Updated: ${result.updated} items`);
    report.push(`Skipped: ${result.skipped} items`);

    if (result.notFound.length > 0) {
      report.push(`Not found: ${result.notFound.join(", ")}`);
    }

    if (result.errors.length > 0) {
      report.push(`Errors: ${result.errors.join("; ")}`);
    }

    if (Object.keys(result.calculatedCmp).length > 0) {
      report.push("Calculated CMP values:");
      Object.entries(result.calculatedCmp).forEach(([sku, cmp]) => {
        report.push(`  ${sku}: ${cmp.toFixed(2)}`);
      });
    }

    return report;
  }
}

/**
 * Factory function to create an invoice processor
 * @param spreadsheetId - The Google Sheets spreadsheet ID
 * @returns InvoiceProcessor instance
 */
export function createInvoiceProcessor(
  spreadsheetId: string
): InvoiceProcessor {
  return new InvoiceProcessorImpl(spreadsheetId);
}
