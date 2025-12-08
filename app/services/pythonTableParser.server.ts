import { PdfExtractionResult, ParsedInvoiceData } from "./pdfParsing.server";
import { extractPdfTablesEnhanced } from "./pythonPdfExtractor.server";
import { spawn } from "child_process";
import { join } from "path";


// Define types for Python extraction results
interface PythonTable {
  page: number | string;
  method: string;
  table_number: number;
  shape: [number, number];
  data: any[][];
  headers: string[];
}

interface PythonExtractionResult {
  tables?: PythonTable[];
  total_found?: number;
  method?: string;
  error?: string;
}

/**
 * Python-based parser for complex PDF tables
 * This parser uses Python libraries for better table extraction
 */
export class PythonTableParser {
  async parse(
    pdfPath: string,
    supplierName?: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Python-based table extraction");
      console.log(`🐍 Supplier name received: '${supplierName}'`);

      // Use specific parser for Buchteiner
      if (supplierName && supplierName.toLowerCase().includes("buchsteiner")) {
        return await this.parseBuchteinerInvoice(pdfPath);
      }

      // Use specific parser for Shaker Store
      if (supplierName && supplierName.toLowerCase().includes("shaker")) {
        return await this.parseShakerStoreInvoice(pdfPath);
      }

      // Use specific parser for Prolife
      if (supplierName && supplierName.toLowerCase().includes("prolife")) {
        console.log(`🐍 Detected Prolife supplier: ${supplierName}`);
        return await this.parseProlifeInvoice(pdfPath);
      }

      // Use specific parser for Pro Supply
      if (supplierName && supplierName.toLowerCase().includes("pro supply")) {
        return await this.parseProSupplyInvoice(pdfPath);
      }

      // Use specific parser for Nutrimeo
      if (supplierName && supplierName.toLowerCase().includes("nutrimeo")) {
        return await this.parseNutrimeoInvoice(pdfPath);
      }

      // Use specific parser for Novoma
      if (supplierName && supplierName.toLowerCase().includes("novoma")) {
        return await this.parseNovomaInvoice(pdfPath);
      }

      // Use specific parser for Nutrimea
      if (supplierName && supplierName.toLowerCase().includes("nutrimea")) {
        return await this.parseNutrimeaInvoice(pdfPath);
      }

      // Use specific parser for DSL Global
      if (supplierName && supplierName.toLowerCase().includes("dsl global")) {
        return await this.parseDslGlobalInvoice(pdfPath);
      }

      // Use specific parser for Powerbody
      if (supplierName && supplierName.toLowerCase().includes("powerbody")) {
        return await this.parsePowerbodyInvoice(pdfPath);
      }

      // Extract tables using Python libraries
      const tableResult = await extractPdfTablesEnhanced(pdfPath);

      if (!tableResult.tables || tableResult.tables.length === 0) {
        return {
          success: false,
          error: "No tables found in PDF using Python extraction",
        };
      }

      console.log(
        `🐍 Found ${tableResult.tables.length} tables using Python extraction`,
      );

      // Convert extracted tables to our invoice format
      const parsedData = this.convertTablesToInvoiceData(tableResult.tables);

      return {
        success: true,
        data: parsedData,
      };
    } catch (error: any) {
      console.error("🐍 Python table parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Python table parsing failed",
      };
    }
  }

  /**
   * Clean doubled characters from extracted text
   * Some PDF extractors duplicate every character (e.g., "AAppppllee" instead of "Apple")
   * @param text - Text to clean
   * @returns Cleaned text
   */
  private cleanDoubledCharacters(text: string): string {
    if (!text || typeof text !== 'string' || text.length < 2) return text;

    // Skip cleaning if the string is all the same digit (e.g., "99", "111", "222")
    // These are likely real numbers, not doubled characters
    if (/^(\d)\1+$/.test(text)) {
      return text; // Don't clean repeated digits
    }

    // Special case: if the string length is even and ALL characters are paired duplicates
    // Example: "1144" → "14", "FFllaagg" → "Flag"
    // BUT NOT "99" (real number) or "aa" (ambiguous)
    if (text.length % 2 === 0 && text.length >= 4) {
      let allPaired = true;
      for (let i = 0; i < text.length; i += 2) {
        if (text[i] !== text[i + 1]) {
          allPaired = false;
          break;
        }
      }

      if (allPaired) {
        // Every character is doubled, clean by taking every other character
        let cleaned = '';
        for (let i = 0; i < text.length; i += 2) {
          cleaned += text[i];
        }
        return cleaned;
      }
    }

    // For mixed or longer strings, use the percentage-based approach
    let consecutiveDuplicates = 0;
    let totalChars = 0;

    for (let i = 0; i < text.length - 1; i++) {
      // Skip whitespace and newlines in the check
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') {
        continue;
      }
      totalChars++;
      if (text[i] === text[i + 1] && text[i] !== ' ' && text[i] !== '\n') {
        consecutiveDuplicates++;
      }
    }

    // If more than 40% of characters have a consecutive duplicate, clean it
    if (totalChars > 5 && consecutiveDuplicates > totalChars * 0.4) {
      let cleaned = '';
      for (let i = 0; i < text.length; i++) {
        // Take every other character if it's the same as the next one
        if (i + 1 < text.length && text[i] === text[i + 1] &&
          text[i] !== ' ' && text[i] !== '\n' && text[i] !== '\t') {
          cleaned += text[i];
          i++; // Skip the duplicate
        } else {
          cleaned += text[i];
        }
      }
      return cleaned;
    }

    return text;
  }

  /**
   * Clean doubled characters from table data
   * @param table - Table to clean
   * @returns Cleaned table
   */
  private cleanTableData(table: PythonTable): PythonTable {
    const cleanedData = table.data.map(row =>
      row.map(cell => {
        if (typeof cell === 'string') {
          return this.cleanDoubledCharacters(cell);
        }
        return cell;
      })
    );

    const cleanedHeaders = table.headers.map(header =>
      typeof header === 'string' ? this.cleanDoubledCharacters(header) : header
    );

    return {
      ...table,
      data: cleanedData,
      headers: cleanedHeaders
    };
  }

  /**
   * Convert extracted tables to our invoice data format
   * @param tables - Array of extracted tables
   * @returns ParsedInvoiceData
   */
  private convertTablesToInvoiceData(tables: PythonTable[]): ParsedInvoiceData {
    const result: ParsedInvoiceData = {
      supplierInfo: {},
      invoiceMetadata: {
        currency: "EUR",
        shippingFee: 0,
      },
      lineItems: [],
    };

    console.log(`🐍 Converting ${tables.length} tables to invoice data`);

    // Process each table to find line items
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];

      // Clean doubled characters if present
      const cleanedTable = this.cleanTableData(table);

      console.log(`🐍 Processing table ${i}:`, JSON.stringify(cleanedTable, null, 2));
      const lineItems = this.parseTableForLineItems(cleanedTable);
      console.log(`🐍 Found ${lineItems.length} line items in table ${i}`);
      result.lineItems.push(...lineItems);
    }

    // Try to extract metadata from any table
    this.extractMetadataFromTables(tables, result);

    console.log(
      `🐍 Final result: ${result.lineItems.length} line items, shipping fee: €${result.invoiceMetadata.shippingFee}`,
    );

    return result;
  }

  /**
   * Parse a single table for line items
   * @param table - Extracted table data
   * @returns Array of line items
   */
  private parseTableForLineItems(table: PythonTable): any[] {
    const lineItems: any[] = [];

    if (!table.data || !Array.isArray(table.data)) {
      return lineItems;
    }

    // Get headers if available
    const headers = table.headers || [];
    const dataRows = table.data;

    // Special handling for Yamamoto format (single row with newline-separated values)
    if (this.isYamamotoFormat(dataRows)) {
      console.log("🐍 Detected Yamamoto format table");
      return this.parseYamamotoFormat(dataRows);
    }

    // Special handling for Rabeko format (French headers)
    if (this.isRabekoFormat(headers, dataRows)) {
      console.log("🐍 Detected Rabeko format table");
      return this.parseRabekoFormat(dataRows, headers);
    }

    // Try to identify column positions
    const columnMap = this.identifyColumns(headers, dataRows);
    console.log(`🐍 Column mapping:`, columnMap);
    console.log(`🐍 Headers:`, headers);

    // Check if this is a Swanson table (has specific headers)
    const isSwansonTable = headers.some(
      (header) =>
        String(header).toLowerCase().includes("exp. date") ||
        String(header).toLowerCase().includes("unit price"),
    );

    // Check if this is an Addict-like French table
    const isAddictTable = headers.some((header) => {
      const h = String(header).toLowerCase();
      return (
        h.includes("libell") ||
        h.includes("prix ht") ||
        h === "pu" ||
        h === "q."
      );
    });

    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      // Skip header rows
      if (i === 0 && this.isHeaderRow(row, headers)) {
        continue;
      }

      // For Swanson tables, check if this is a shipping row
      if (isSwansonTable) {
        const description = columnMap.description !== undefined && row[columnMap.description]
          ? String(row[columnMap.description]).toLowerCase().trim()
          : "";

        if (description === "shipping" || description.includes("shipping fee")) {
          // Extract shipping fee
          const shippingFee = this.extractShippingFee(row, columnMap);
          if (shippingFee > 0) {
            this.swansonShippingFee = shippingFee;
            console.log(`🐍 Extracted Swanson shipping fee: €${shippingFee}`);
          }
          continue; // Skip adding to line items
        }
      }

      // Parse row for line item data
      const lineItem = this.parseRow(row, columnMap, isSwansonTable);
      if (lineItem) {
        // For Addict tables, ensure numbers are normalized and compute total if missing
        if (isAddictTable) {
          if (
            typeof lineItem.unitPrice === "number" &&
            typeof lineItem.quantity === "number"
          ) {
            lineItem.total =
              Math.round(lineItem.unitPrice * lineItem.quantity * 100) / 100;
          }
        }
        lineItems.push(lineItem);
      }
    }

    return lineItems;
  }

  /**
   * Check if this is a Yamamoto format table (single row with newline-separated values)
   * @param dataRows - Table data rows
   * @returns boolean
   */
  private isYamamotoFormat(dataRows: any[][]): boolean {
    // Yamamoto format has 2 rows: header row and a single data row with newline-separated values
    if (dataRows.length !== 2) {
      return false;
    }

    // Check if the second row has newline-separated values in multiple columns
    const dataRow = dataRows[1];
    let newlineCount = 0;

    // Count columns with newlines
    for (let i = 0; i < Math.min(dataRow.length, 8); i++) {
      // Check first 8 columns
      const cell = dataRow[i];
      if (cell && String(cell).includes("\n")) {
        newlineCount++;
      }
    }

    // If multiple columns have newlines, it's likely Yamamoto format
    return newlineCount >= 3;
  }

  /**
   * Parse Yamamoto format table (single row with newline-separated values)
   * @param dataRows - Table data rows
   * @returns Array of line items
   */
  private parseYamamotoFormat(dataRows: any[][]): any[] {
    const lineItems: any[] = [];

    if (dataRows.length < 2) {
      return lineItems;
    }

    const dataRow = dataRows[1]; // Second row contains all the data

    // Extract columns (based on the Yamamoto structure we saw in logs)
    const skus = dataRow[0] ? String(dataRow[0]).split("\n") : [];
    const descriptions = dataRow[1] ? String(dataRow[1]).split("\n") : [];
    const units = dataRow[2] ? String(dataRow[2]).split("\n") : []; // Usually "PZ"
    const quantities = dataRow[3] ? String(dataRow[3]).split("\n") : [];
    const unitPrices = dataRow[4] ? String(dataRow[4]).split("\n") : [];
    const amounts = dataRow[6] ? String(dataRow[6]).split("\n") : []; // Skip index 5 (%DS.)
    const vatCodes = dataRow[7] ? String(dataRow[7]).split("\n") : [];

    console.log(
      `🐍 Found ${skus.length} potential line items in Yamamoto format`,
    );

    // Process each line item
    const itemCount = Math.min(
      skus.length,
      quantities.length,
      unitPrices.length,
      amounts.length,
    );

    for (let i = 0; i < itemCount; i++) {
      try {
        const sku = skus[i]?.trim() || "";
        let description = "";
        const quantityStr = quantities[i]?.trim() || "";
        const unitPriceStr = unitPrices[i]?.trim() || "";
        const amountStr = amounts[i]?.trim() || "";

        // Validate SKU format
        if (!sku || !/^(IAF|FITT|YAM)[A-Z0-9]*\d+/.test(sku)) {
          console.log(`🐍 Skipping invalid SKU: \${sku}`);
          continue;
        }

        // Handle multi-line descriptions - combine product name with tariff info
        if (descriptions.length > i) {
          // Get the main product description
          description = descriptions[i]?.trim() || "";

          // Check if the next line might be tariff info
          if (descriptions.length > i + 1) {
            const nextLine = descriptions[i + 1]?.trim() || "";
            // If it looks like tariff info, append it
            if (
              nextLine.includes("tariff:") ||
              nextLine.includes("Custom") ||
              nextLine.includes("custom")
            ) {
              description += " " + nextLine;
            }
          }
        }

        // Parse numbers correctly
        const quantity = this.parseYamamotoQuantity(quantityStr);
        const unitPrice = this.parsePrice(unitPriceStr, true); // Allow multi-digit decimals

        if (quantity === null || unitPrice === null) {
          console.log(
            `🐍 Skipping item with invalid numbers: qty=\${quantityStr}, price=\${unitPriceStr}`,
          );
          continue;
        }

        // Calculate the final amount from quantity × unit price
        const calculatedTotal = Math.round(quantity * unitPrice * 100) / 100;

        // Get parsed total for comparison/validation
        const parsedTotal = this.parsePrice(amountStr, true);

        console.log(
          `🐍 Parsed Yamamoto item: \${sku}, qty=\${quantity}, price=\${unitPrice}, calculated_total=\${calculatedTotal}, parsed_total=\${parsedTotal}`,
        );

        lineItems.push({
          supplierSku: sku,
          description: description,
          quantity: quantity,
          unitPrice: unitPrice,
          total: calculatedTotal, // Use calculated total, not parsed
        });
      } catch (error) {
        console.error(`🐍 Error parsing Yamamoto item \${i}:`, error);
      }
    }

    return lineItems;
  }

  /**
   * Parse Yamamoto quantity string (15,00 → 15)
   * @param qtyStr - Quantity string
   * @returns Parsed quantity or null
   */
  private parseYamamotoQuantity(qtyStr: string): number | null {
    try {
      const cleanStr = qtyStr.trim();

      // Handle comma-separated numbers (15,00 → 15)
      if (cleanStr.includes(",")) {
        const parts = cleanStr.split(",");
        // If it ends with ,00 or ,0, it's likely a whole number with decimal zeros
        if (parts.length === 2 && (parts[1] === "00" || parts[1] === "0")) {
          const qty = parseInt(parts[0], 10);
          return isNaN(qty) ? null : qty;
        }
      }

      // Parse as regular integer
      const qty = parseInt(cleanStr, 10);
      return isNaN(qty) ? null : qty;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract shipping fee from a shipping row
   * @param row - Row data
   * @param columnMap - Column mapping
   * @returns shipping fee or 0
   */
  private extractShippingFee(row: any[], columnMap: any): number {
    try {
      // Look for price in the amount column first (if we have column mapping)
      if (columnMap.total !== undefined && row[columnMap.total]) {
        const cell = row[columnMap.total];
        const text = String(cell).trim();
        // Look for € amount pattern
        const euroMatch = text.match(/€?\s*(\d+(?:[.,]\d+)?)/i);
        if (euroMatch) {
          const value = this.parsePrice(euroMatch[1]);
          if (value && value > 0) {
            return value;
          }
        }
        // Look for plain decimal number
        const decimalMatch = text.match(/(\d+[.,]\d{2,})/);
        if (decimalMatch) {
          const value = this.parsePrice(decimalMatch[1]);
          if (value && value > 0) {
            return value;
          }
        }
      }

      // Fallback: Look for price in any column with price format
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (cell) {
          const text = String(cell).trim();
          // Look for € amount pattern
          const euroMatch = text.match(/€?\s*(\d+(?:[.,]\d+)?)/i);
          if (euroMatch) {
            const value = this.parsePrice(euroMatch[1]);
            if (value && value > 0) {
              return value;
            }
          }
          // Look for plain decimal number
          const decimalMatch = text.match(/(\d+[.,]\d{2,})/);
          if (decimalMatch) {
            const value = this.parsePrice(decimalMatch[1]);
            if (value && value > 0) {
              return value;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error extracting shipping fee:", error);
    }
    return 0;
  }

  /**
   * Identify column positions based on headers
   * @param headers - Table headers
   * @param dataRows - Table data rows
   * @returns Column mapping
   */
  private identifyColumns(headers: string[], dataRows: any[][]): any {
    const columnMap: any = {};

    // If we have headers, use them
    if (headers.length > 0) {
      headers.forEach((header, index) => {
        // Normalize header: lowercase, replace newlines with spaces, trim
        const normalized = String(header).toLowerCase().replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        // French variants for Addict invoices: Libellé (description), Q. (quantity), PU (unit price), Prix HT (total)
        if (
          normalized.includes("item") ||
          normalized.includes("sku") ||
          normalized.includes("code") ||
          normalized.includes("réf") || // Réf. / reference
          normalized.includes("ref")
        ) {
          columnMap.sku = index;
        } else if (
          normalized.includes("description") ||
          normalized.includes("libell") || // Libellé
          normalized.includes("product") ||
          normalized.includes("name")
        ) {
          columnMap.description = index;
        } else if (
          normalized.includes("qty") ||
          normalized.includes("quantity") ||
          normalized === "q." ||
          normalized.startsWith("q ")
        ) {
          columnMap.quantity = index;
        } else if (
          (normalized.includes("unit") && normalized.includes("price")) ||
          normalized.includes("unit price") ||
          normalized === "pu" // Prix unitaire
        ) {
          columnMap.unitPrice = index;
        } else if (
          normalized.includes("amount") ||
          normalized.includes("total") ||
          normalized.includes("prix ht") || // Prix HT column
          normalized.includes("montant ht")
        ) {
          columnMap.total = index;
        } else if (normalized.includes("exp") && normalized.includes("date")) {
          columnMap.expDate = index;
        }
      });
    }

    // If no headers or incomplete mapping, try to infer from data
    if (Object.keys(columnMap).length < 3) {
      this.inferColumnsFromData(dataRows, columnMap);
    }

    return columnMap;
  }

  /**
   * Infer column positions from data patterns
   * @param dataRows - Table data rows
   * @param columnMap - Existing column mapping to update
   */
  private inferColumnsFromData(dataRows: any[][], columnMap: any): void {
    if (dataRows.length === 0) return;

    // Look at first few rows to identify patterns
    const sampleRows = dataRows.slice(0, Math.min(5, dataRows.length));
    const columnCount = dataRows[0].length;

    for (let col = 0; col < columnCount; col++) {
      // Skip already mapped columns
      if (Object.values(columnMap).includes(col)) continue;

      // Collect sample values from this column
      const values = sampleRows
        .map((row) => row[col])
        .filter((val) => val != null)
        .map((val) => String(val).trim());

      if (values.length === 0) continue;

      // Check for SKU patterns
      const skuMatches = values.filter((val) =>
        /^(IAF|FITT|YAM|SW)[A-Z0-9]*\d+/.test(val),
      );
      if (skuMatches.length >= values.length * 0.6) {
        // 60% match
        columnMap.sku = col;
        continue;
      }
      // Generic code-like pattern (alphanumeric without spaces, not purely numeric)
      const genericCodeMatches = values.filter(
        (val) => /^[A-Za-z0-9\-_.]{3,}$/.test(val) && !/^\d+$/.test(val),
      );
      if (!columnMap.sku && genericCodeMatches.length >= values.length * 0.6) {
        columnMap.sku = col;
        continue;
      }

      // Check for quantity patterns (numbers)
      const qtyMatches = values.filter((val) => /^\d+(?:[.,]\d+)?$/.test(val));
      if (qtyMatches.length >= values.length * 0.8) {
        // 80% match
        columnMap.quantity = col;
        continue;
      }

      // Check for price patterns (including multi-digit decimals)
      const priceMatches = values.filter(
        (val) =>
          /^-?\d+[.,]\d{2,}$/.test(val) || /^€?\s*-?\d+[.,]?\d*$/.test(val),
      );
      if (priceMatches.length >= values.length * 0.6) {
        // 60% match
        if (columnMap.unitPrice === undefined) {
          columnMap.unitPrice = col;
        } else if (columnMap.total === undefined) {
          columnMap.total = col;
        }
        continue;
      }
    }
  }

  /**
   * Check if a row is a header row
   * @param row - Row data
   * @param headers - Headers array
   * @returns boolean
   */
  private isHeaderRow(row: any[], headers: string[]): boolean {
    // If headers match row exactly, it's a header row
    if (headers.length === row.length) {
      return headers.every(
        (header, index) =>
          String(header).toLowerCase() === String(row[index]).toLowerCase(),
      );
    }
    return false;
  }

  /**
   * Parse a single row for line item data
   * @param row - Row data
   * @param columnMap - Column mapping
   * @param isSwansonTable - Whether this is a Swanson table format
   * @returns Line item object or null
   */
  private parseRow(
    row: any[],
    columnMap: any,
    isSwansonTable: boolean = false,
  ): any | null {
    try {
      const lineItem: any = {};

      // Extract SKU: if a SKU column is identified, accept any non-empty string (to support suppliers like Addict)
      if (columnMap.sku !== undefined && row[columnMap.sku]) {
        const skuValue = String(row[columnMap.sku]).trim();
        if (skuValue) {
          lineItem.supplierSku = skuValue;
        }
      }

      // If no SKU, set to empty string (some invoices don't have SKU columns)
      if (!lineItem.supplierSku) {
        lineItem.supplierSku = "";
      }

      // Extract description
      if (columnMap.description !== undefined && row[columnMap.description]) {
        lineItem.description = String(row[columnMap.description]).trim();
      }

      // Extract quantity
      if (columnMap.quantity !== undefined && row[columnMap.quantity]) {
        const qtyValue = String(row[columnMap.quantity]).trim();
        // Support European formats and decimals by normalizing separators
        const normalizedQty = qtyValue.replace(/\s/g, "").replace(",", ".");
        const qty = parseFloat(normalizedQty);
        if (!isNaN(qty)) {
          // Quantities are usually integers; if decimal, keep as number
          lineItem.quantity = qty;
        }
      }

      // Extract unit price (handle multi-digit decimals for Swanson)
      if (columnMap.unitPrice !== undefined && row[columnMap.unitPrice]) {
        const priceValue = String(row[columnMap.unitPrice]).trim();
        const price = this.parsePrice(priceValue, isSwansonTable);
        if (price !== null) {
          lineItem.unitPrice = price;
        }
      }

      // Extract total
      if (columnMap.total !== undefined && row[columnMap.total]) {
        const totalValue = String(row[columnMap.total]).trim();
        const total = this.parsePrice(totalValue, isSwansonTable);
        if (total !== null) {
          lineItem.total = total;
        }
      }

      // A line item is valid if it has:
      // - (SKU or description) AND quantity
      // This allows for invoices that don't have SKU columns (like Powerbody)
      const hasIdentifier = lineItem.supplierSku || lineItem.description;
      const hasQuantity = lineItem.quantity !== undefined && lineItem.quantity > 0;

      if (hasIdentifier && hasQuantity) {
        // Always calculate the total from quantity × unit price
        // This ensures consistency and validates against parsed totals
        if (lineItem.unitPrice !== undefined) {
          lineItem.total =
            Math.round(lineItem.unitPrice * lineItem.quantity * 100) / 100;
        } else if (lineItem.total !== undefined && lineItem.quantity !== 0) {
          // Calculate unit price from total and quantity if needed
          lineItem.unitPrice =
            Math.round((lineItem.total / lineItem.quantity) * 10000) / 10000;
        }

        return lineItem;
      }

      return null;
    } catch (error) {
      console.error("Error parsing row:", error);
      return null;
    }
  }

  /**
   * Parse price string to number with support for multi-digit decimals
   * @param priceStr - Price string
   * @param allowMultiDigitDecimals - Whether to allow more than 2 decimal places
   * @returns Parsed price or null
   */
  private parsePrice(
    priceStr: string,
    allowMultiDigitDecimals: boolean = false,
  ): number | null {
    try {
      let cleanStr = priceStr.trim();

      // Handle negative sign
      const isNegative = cleanStr.startsWith("-");
      if (isNegative) {
        cleanStr = cleanStr.substring(1);
      }

      // Remove currency symbols and extra spaces
      cleanStr = cleanStr.replace(/[€$£¥]/g, "").trim();

      // Handle thousand separators and decimal separators
      if (cleanStr.includes(",") && cleanStr.includes(".")) {
        // Multiple separators - determine which is thousands vs decimal
        const lastComma = cleanStr.lastIndexOf(",");
        const lastPeriod = cleanStr.lastIndexOf(".");

        // The rightmost separator with exactly 2 digits after is likely decimal
        if (lastComma > lastPeriod) {
          // Format like 1.352,00 (European)
          const afterComma = cleanStr.substring(lastComma + 1);
          if (afterComma.length === 2 && /^\d{2}$/.test(afterComma)) {
            // This is European format: "1.352,00" -> "1352.00"
            cleanStr = cleanStr.replace(/\./g, "").replace(",", ".");
          } else {
            // Fallback: remove commas (thousands separator)
            cleanStr = cleanStr.replace(/,/g, "");
          }
        } else {
          // Format like 1,234.56 (US)
          const afterPeriod = cleanStr.substring(lastPeriod + 1);
          if (afterPeriod.length === 2 && /^\d{2}$/.test(afterPeriod)) {
            // This is US format: "1,234.56" -> "1234.56"
            cleanStr = cleanStr.replace(/,/g, "");
          } else {
            // Fallback: remove periods (thousands separator)
            cleanStr = cleanStr.replace(/\./g, "");
          }
        }
      } else if (cleanStr.includes(",")) {
        // Single comma separator
        const parts = cleanStr.split(",");
        if (parts.length === 2 && parts[1].length === 2 && /^\d{2}$/.test(parts[1])) {
          // Decimal separator: 1352,00 → 1352.00
          cleanStr = parts[0] + "." + parts[1];
        } else if (parts.length === 2 && parts[1].length > 2) {
          // Thousands separator: 1,234 → 1234
          cleanStr = cleanStr.replace(/,/g, "");
        } else {
          // Default: treat as decimal separator
          cleanStr = cleanStr.replace(",", ".");
        }
      }

      const price = parseFloat(cleanStr);
      if (isNaN(price)) {
        return null;
      }

      let result = price;
      if (isNegative) {
        result = -result;
      }

      // For Yamamoto/Swanson, we want to preserve multi-digit decimals
      if (allowMultiDigitDecimals) {
        // Round to reasonable precision (up to 4 decimal places)
        return Math.round(result * 10000) / 10000;
      } else {
        // Standard 2 decimal places
        return Math.round(result * 100) / 100;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract metadata from tables
   * @param tables - Extracted tables
   * @param result - Parsed invoice data to update
   */
  private extractMetadataFromTables(
    tables: PythonTable[],
    result: ParsedInvoiceData,
  ): void {
    let maxShippingFee = 0;

    // Use Rabeko shipping fee if it was extracted
    if (this.rabekoShippingFee !== null && this.rabekoShippingFee > 0) {
      maxShippingFee = this.rabekoShippingFee;
      console.log(`🐍 Using extracted Rabeko shipping fee: €${maxShippingFee}`);
    }

    // Use Swanson shipping fee if it was extracted
    if (this.swansonShippingFee !== null && this.swansonShippingFee > 0) {
      maxShippingFee = this.swansonShippingFee;
      console.log(`🐍 Using extracted Swanson shipping fee: €${maxShippingFee}`);
    }

    // Look through all table data for metadata
    for (const table of tables) {
      if (!table.data || !Array.isArray(table.data)) continue;

      // Check headers for shipping information
      if (table.headers) {
        const headerText = table.headers.join(" ").toLowerCase();
        if (
          headerText.includes("shipping") ||
          headerText.includes("spedizione")
        ) {
          // Look for shipping value in the data
          for (const row of table.data) {
            for (const cell of row) {
              const cellText = String(cell || "").trim();
              const shippingMatch = cellText.match(
                /(?:€|eur)?\s*(\d+[.,]\d{2,})/i,
              );
              if (shippingMatch) {
                const shippingValue = this.parsePrice(shippingMatch[1]);
                if (shippingValue && shippingValue > maxShippingFee) {
                  maxShippingFee = shippingValue;
                }
              }
            }
          }
        }
      }

      // Look through data rows for dates and invoice numbers
      for (const row of table.data) {
        for (const cell of row) {
          const cellText = String(cell || "").trim();

          // Extract invoice date (various formats)
          const dateMatch =
            cellText.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/) ||
            cellText.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
          if (dateMatch && !result.invoiceMetadata.invoiceDate) {
            try {
              if (dateMatch[1].length === 4) {
                // YYYY-MM-DD format
                result.invoiceMetadata.invoiceDate = new Date(
                  `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
                );
              } else {
                // DD/MM/YYYY format
                result.invoiceMetadata.invoiceDate = new Date(
                  `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
                );
              }
            } catch (e) {
              // Ignore invalid dates
            }
          }

          // Extract invoice number - improve the regex
          const invoiceMatch =
            cellText.match(
              /(?:invoice|no\.?|n\.?|number)[\s:]*([A-Z0-9\-_]+)/i,
            ) || cellText.match(/No:[\s]*([A-Z0-9\-_]+)/i);
          if (invoiceMatch && !result.invoiceMetadata.invoiceNumber) {
            result.invoiceMetadata.invoiceNumber = invoiceMatch[1];
          }

          // Look for shipping costs in regular rows
          const lowerText = cellText.toLowerCase();
          if (
            lowerText.includes("shipping") ||
            lowerText.includes("spedizione") ||
            lowerText.includes("envío") ||
            lowerText.includes("livraison") ||
            lowerText.includes("transport") ||
            lowerText.includes("fracht") ||
            lowerText.includes("frais")
          ) {
            // Look for price in nearby cells or in the same cell
            const euroMatch = cellText.match(/(?:€|eur)?\s*(\d+[.,]\d{2,})/i);
            if (euroMatch) {
              const shippingValue = this.parsePrice(euroMatch[1]);
              if (shippingValue && shippingValue > maxShippingFee) {
                maxShippingFee = shippingValue;
              }
            }
          }
        }
      }
    }

    // Set the shipping fee if found
    if (maxShippingFee > 0) {
      result.invoiceMetadata.shippingFee = maxShippingFee;
    }
  }

  /**
   * Check if this is a Rabeko format table
   * @param headers - Table headers
   * @param dataRows - Table data rows
   * @returns boolean
   */
  private isRabekoFormat(headers: string[], dataRows: any[][]): boolean {
    // Check for Rabeko-specific headers (French)
    if (headers.length >= 4) {
      const headerText = headers.join(" ").toLowerCase();
      if (
        headerText.includes("description") &&
        headerText.includes("quantité") &&
        headerText.includes("unitaire") &&
        headerText.includes("total")
      ) {
        console.log("🐍 Detected Rabeko format table (French headers)");
        return true;
      }
    }

    // Check for Rabeko content patterns in data
    if (dataRows.length > 2) {
      // Look for typical Rabeko product descriptions
      const sampleRows = dataRows.slice(1, Math.min(5, dataRows.length)); // Skip header row
      for (const row of sampleRows) {
        if (row.length >= 4) {
          const description = String(row[0] || "").toLowerCase();
          // Look for characteristic Rabeko product names
          if (
            description.includes("zero confiture") ||
            description.includes("sirop zero") ||
            description.includes("sauce zero") ||
            description.includes("choco sirop") ||
            description.includes("salted caramel")
          ) {
            console.log("🐍 Detected Rabeko format table (content patterns)");
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Parse Rabeko format table
   * @param dataRows - Table data rows
   * @param headers - Table headers
   * @returns Array of line items
   */
  private rabekoShippingFee: number | null = null;
  private swansonShippingFee: number | null = null;

  private parseRabekoFormat(dataRows: any[][], headers: string[]): any[] {
    const lineItems: any[] = [];
    this.rabekoShippingFee = null; // Reset shipping fee

    if (dataRows.length < 2) {
      return lineItems;
    }

    console.log("🐍 Parsing Rabeko format table");

    // Identify column positions from headers
    const columnMap: any = {};
    headers.forEach((header, index) => {
      const normalized = String(header).toLowerCase();
      if (normalized.includes("description")) {
        columnMap.description = index;
      } else if (normalized.includes("quantité")) {
        columnMap.quantity = index;
      } else if (normalized.includes("unitaire")) {
        columnMap.unitPrice = index;
      } else if (normalized.includes("tva")) {
        columnMap.vat = index;
      } else if (normalized.includes("total")) {
        columnMap.total = index;
      }
    });

    console.log(`🐍 Rabeko column mapping:`, columnMap);

    // Process each row (skip header row)
    for (let i = 1; i < dataRows.length; i++) {
      const row = dataRows[i];

      // Skip empty rows
      if (
        !row ||
        row.length === 0 ||
        row.every((cell) => !cell || String(cell).trim() === "")
      ) {
        continue;
      }

      try {
        const description =
          columnMap.description !== undefined && row[columnMap.description]
            ? String(row[columnMap.description]).trim()
            : "";

        // Skip if description is empty
        if (!description) {
          continue;
        }

        // Extract shipping fee from transport row
        if (description.toLowerCase().includes("transport")) {
          // Try to extract the shipping amount from the total column
          let shippingAmount = 0;
          if (columnMap.total !== undefined && row[columnMap.total]) {
            const totalStr = String(row[columnMap.total]).trim();
            const totalValue = this.parsePrice(totalStr, true);
            if (totalValue !== null) {
              shippingAmount = totalValue;
            }
          } else if (columnMap.unitPrice !== undefined && row[columnMap.unitPrice]) {
            // Fallback to unit price if total not available
            const priceStr = String(row[columnMap.unitPrice]).trim();
            const priceValue = this.parsePrice(priceStr, true);
            if (priceValue !== null) {
              shippingAmount = priceValue;
            }
          }

          if (shippingAmount > 0) {
            this.rabekoShippingFee = shippingAmount;
            console.log(
              `🐍 Extracted Rabeko shipping fee: €${shippingAmount} from transport row`,
            );
          }
          continue; // Skip adding to line items
        }

        // Parse quantity
        let quantity = 1;
        if (columnMap.quantity !== undefined && row[columnMap.quantity]) {
          const qtyStr = String(row[columnMap.quantity]).trim();
          // Handle European format (comma as decimal separator)
          const qtyValue = parseInt(qtyStr.replace(",", ""), 10);
          if (!isNaN(qtyValue) && qtyValue > 0) {
            quantity = qtyValue;
          }
        }

        // Parse unit price
        let unitPrice = 0;
        if (columnMap.unitPrice !== undefined && row[columnMap.unitPrice]) {
          const priceStr = String(row[columnMap.unitPrice]).trim();
          const priceValue = this.parsePrice(priceStr, true);
          if (priceValue !== null) {
            unitPrice = priceValue;
          }
        }

        // Parse total
        let total = 0;
        if (columnMap.total !== undefined && row[columnMap.total]) {
          const totalStr = String(row[columnMap.total]).trim();
          const totalValue = this.parsePrice(totalStr, true);
          if (totalValue !== null) {
            total = totalValue;
          }
        } else {
          // Calculate total if not provided
          total = Math.round(quantity * unitPrice * 100) / 100;
        }

        // Skip rows with zero values (likely empty/footer rows)
        if (quantity === 0 && unitPrice === 0 && total === 0) {
          continue;
        }

        // Regular product item
        console.log(
          `🐍 Parsed Rabeko item: ${description}, qty=${quantity}, price=${unitPrice}, total=${total}`,
        );

        // For Rabeko, we need to generate a pseudo-SKU since they don't provide real SKUs
        const pseudoSku = this.generatePseudoSku(description);

        lineItems.push({
          supplierSku: pseudoSku,
          description: description,
          quantity: quantity,
          unitPrice: unitPrice,
          total: total,
        });
      } catch (error) {
        console.error(`🐍 Error parsing Rabeko row ${i}:`, error);
      }
    }

    return lineItems;
  }

  /**
   * Generate pseudo-SKU from description for suppliers that don't provide real SKUs
   * @param description - Product description
   * @returns Generated pseudo-SKU
   */
  private generatePseudoSku(description: string): string {
    // Create a hash-based SKU from the description
    let hash = 0;
    for (let i = 0; i < description.length; i++) {
      const char = description.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to positive number and format as pseudo-SKU
    const positiveHash = Math.abs(hash)
      .toString(16)
      .toUpperCase()
      .substring(0, 8);
    return `RABEKO_${positiveHash}`;
  }

  /**
   * Parse Shaker Store invoice using the dedicated Python parser
   * @param pdfPath - Path to the PDF file
   * @returns Parsed invoice data
   */
  private async parseShakerStoreInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    return new Promise(async (resolve, reject) => {
      const { spawn } = await import("child_process");
      const { join } = await import("path");

      const pythonScript = join(
        process.cwd(),
        "python/invoice_extractor-shaker_store.py",
      );
      const args = [pythonScript, pdfPath, "--json"];

      console.log(
        `🐍 Using Shaker Store-specific Python parser: ${pythonScript}`,
      );

      // Use Python from venv to ensure all dependencies are available
      const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
      const pythonProcess = spawn(pythonCmd, args, {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code: number) => {
        if (code !== 0) {
          console.error(
            `🐍 Shaker Store parser failed with code ${code}:`,
            stderr,
          );
          resolve({
            success: false,
            error: `Shaker Store parser failed: ${stderr}`,
          });
          return;
        }

        try {
          // Parse the JSON output
          const parsedData = JSON.parse(stdout);

          // Convert to our standard format
          const result: ParsedInvoiceData = {
            supplierInfo: {
              name: parsedData.vendor?.name || "Shaker Store",
              address: parsedData.vendor?.address,
              vatNumber: parsedData.vendor?.vatNumber,
            },
            invoiceMetadata: {
              invoiceNumber: parsedData.metadata?.invoice_number,
              invoiceDate: parsedData.metadata?.invoice_date
                ? new Date(parsedData.metadata.invoice_date)
                : undefined,
              currency: "EUR",
              shippingFee: parseFloat(parsedData.metadata?.shipping_fee || "0"),
              subtotal: parseFloat(parsedData.totals?.subtotal || "0"),
              total: parseFloat(parsedData.totals?.total || "0"),
            },
            lineItems: (parsedData.order_items || []).map((item: any) => ({
              supplierSku: item.article_number || item.reference || "",
              description: item.description || "",
              quantity: parseInt(item.quantity || "0"),
              unitPrice: parseFloat(item.unit_price || "0"),
              total: parseFloat(item.total_price || item.total || "0"),
            })),
          };

          console.log(
            `🐍 Shaker Store parser completed with ${result.lineItems.length} line items`,
          );

          resolve({
            success: true,
            data: result,
          });
        } catch (parseError) {
          console.error(
            "🐍 Error parsing Shaker Store JSON output:",
            parseError,
          );
          console.error("🐍 Raw output:", stdout);
          resolve({
            success: false,
            error: `Failed to parse Shaker Store parser output: ${parseError}`,
          });
        }
      });

      pythonProcess.on("error", (error: Error) => {
        console.error("🐍 Shaker Store parser spawn error:", error);
        resolve({
          success: false,
          error: `Failed to spawn Shaker Store parser: ${error.message}`,
        });
      });
    });
  }

  /**
=======
   * Parse Buchteiner invoice using the dedicated Python parser
   * @param pdfPath - Path to the PDF file
   * @returns Parsed invoice data
   */
  private async parseBuchteinerInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    return new Promise(async (resolve, reject) => {
      const { spawn } = await import("child_process");
      const { join } = await import("path");

      const pythonScript = join(
        process.cwd(),
        "python/invoice_extractor_buchteiner.py",
      );
      const args = [pythonScript, pdfPath, "--json"];

      console.log(
        `🐍 Using Buchteiner-specific Python parser: ${pythonScript}`,
      );

      // Use Python from venv to ensure all dependencies are available
      const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
      const pythonProcess = spawn(pythonCmd, args, {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code: number) => {
        if (code !== 0) {
          console.error(
            `🐍 Buchteiner parser failed with code ${code}:`,
            stderr,
          );
          resolve({
            success: false,
            error: `Buchteiner parser failed: ${stderr}`,
          });
          return;
        }

        try {
          // Parse the JSON output
          const parsedData = JSON.parse(stdout);

          // Convert to our standard format
          const result: ParsedInvoiceData = {
            supplierInfo: {
              name: parsedData.vendor?.name || "Buchteiner",
              address: parsedData.vendor?.address,
              vatNumber: parsedData.vendor?.vatNumber,
            },
            invoiceMetadata: {
              invoiceNumber: parsedData.metadata?.invoice_number,
              invoiceDate: parsedData.metadata?.invoice_date
                ? new Date(parsedData.metadata.invoice_date)
                : undefined,
              currency: "EUR",
              shippingFee: parseFloat(parsedData.totals?.shipping_fee || "0"),
              subtotal: parseFloat(parsedData.totals?.subtotal || "0"),
              total: parseFloat(parsedData.totals?.total || "0"),
            },
            lineItems: (parsedData.order_items || []).map((item: any) => ({
              supplierSku: item.reference || "",
              description: item.description || "",
              quantity: parseInt(item.quantity || "0"),
              unitPrice: parseFloat(item.unit_price || "0"),
              total: parseFloat(item.total || "0"),
            })),
          };

          console.log(
            `🐍 Buchteiner parser completed with ${result.lineItems.length} line items`,
          );

          resolve({
            success: true,
            data: result,
          });
        } catch (parseError) {
          console.error("🐍 Error parsing Buchteiner JSON output:", parseError);
          console.error("🐍 Raw output:", stdout);
          resolve({
            success: false,
            error: `Failed to parse Buchteiner parser output: ${parseError}`,
          });
        }
      });

      pythonProcess.on("error", (error: Error) => {
        console.error("🐍 Buchteiner parser spawn error:", error);
        resolve({
          success: false,
          error: `Failed to spawn Buchteiner parser: ${error.message}`,
        });
      });
    });
  }

  /**
   * Parse Prolife invoice using the dedicated Python parser
   * @param pdfPath - Path to the PDF file
   * @returns Promise<PdfExtractionResult>
   */
  private async parseProlifeInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    return new Promise((resolve) => {
      // Use Python from venv to ensure all dependencies are available
      const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
      const scriptPath = join(
        process.cwd(),
        "python/invoice_extractor_powerbody.py",
      );

      console.log(
        `🐍 Running Powerbody parser: ${pythonCmd} ${scriptPath} ${pdfPath}`,
      );

      const pythonProcess = spawn(pythonCmd, [scriptPath, pdfPath], {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code: number) => {
        if (code !== 0) {
          console.error(`🐍 Prolife parser failed with code ${code}`);
          console.error(`🐍 Stderr: ${stderr}`);
          resolve({
            success: false,
            error: `Prolife parser failed with exit code ${code}: ${stderr}`,
          });
          return;
        }

        try {
          // Parse the JSON output from the Python script
          console.log(`🐍 Raw Python output: ${stdout}`);

          // Try to extract JSON from the output
          let jsonOutput = "";

          // Look for JSON starting with { and try to find the complete JSON
          const jsonStartIndex = stdout.indexOf('{');
          if (jsonStartIndex !== -1) {
            // Extract everything from the first { to the end
            const potentialJson = stdout.substring(jsonStartIndex).trim();

            // Try to find the last complete } that would close the JSON
            let braceCount = 0;
            let jsonEndIndex = -1;

            for (let i = 0; i < potentialJson.length; i++) {
              if (potentialJson[i] === '{') {
                braceCount++;
              } else if (potentialJson[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEndIndex = i;
                  break;
                }
              }
            }

            if (jsonEndIndex !== -1) {
              jsonOutput = potentialJson.substring(0, jsonEndIndex + 1);
            }
          }

          console.log(`🐍 Extracted JSON lines: ${jsonOutput ? 1 : 0}`);

          if (!jsonOutput) {
            console.error("🐍 No valid JSON found in Prolife parser output");
            console.error("🐍 Raw output:", stdout);
            resolve({
              success: false,
              error: "No valid JSON output from Prolife parser",
            });
            return;
          }

          const parsedData = JSON.parse(jsonOutput);

          if (parsedData.error) {
            resolve({
              success: false,
              error: parsedData.error,
            });
            return;
          }

          // Transform the parsed data to match our interface
          const result: ParsedInvoiceData = {
            supplierInfo: {
              name: "Prolife",
              address: parsedData.supplier_info?.address,
              vatNumber: parsedData.supplier_info?.vat_number,
            },
            invoiceMetadata: {
              invoiceNumber: parsedData.invoice_metadata?.invoice_number,
              invoiceDate: parsedData.invoice_metadata?.invoice_date
                ? new Date(parsedData.invoice_metadata.invoice_date)
                : undefined,
              currency: parsedData.invoice_metadata?.currency || "EUR",
              shippingFee: parseFloat(parsedData.invoice_metadata?.shipping_fee) || 0,
              subtotal: parseFloat(parsedData.invoice_metadata?.subtotal) || 0,
              total: parseFloat(parsedData.invoice_metadata?.total) || 0,
            },
            lineItems:
              parsedData.line_items?.map((item: any) => ({
                supplierSku: item.sku, // Map sku to supplierSku for consistency
                description: item.description,
                quantity: parseInt(item.quantity) || 0,
                unitPrice: parseFloat(item.unit_price) || 0,
                total: parseFloat(item.total) || 0,
                source: item.source || "prolife_parser",
              })) || [],
          };

          console.log(
            `🐍 Prolife parser extracted ${result.lineItems.length} items`,
          );

          resolve({
            success: true,
            data: result,
          });
        } catch (parseError) {
          console.error("🐍 Error parsing Prolife JSON output:", parseError);
          console.error("🐍 Raw output:", stdout);
          resolve({
            success: false,
            error: `Failed to parse Prolife parser output: ${parseError}`,
          });
        }
      });

      pythonProcess.on("error", (error: Error) => {
        console.error("🐍 Prolife parser spawn error:", error);
        resolve({
          success: false,
          error: `Failed to spawn Prolife parser: ${error.message}`,
        });
      });
    });
  }

  private async parseProSupplyInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Pro Supply Python parser");
      const { spawn } = await import("child_process");
      const { join } = await import("path");
      // Use Python from venv to ensure all dependencies are available
      const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
      const scriptPath = join(
        process.cwd(),
        "python/invoice_extractor-pro_supply.py",
      );
      const args = [scriptPath, pdfPath, "--json"];
      const py = spawn(pythonCmd, args, { cwd: process.cwd() });
      let stdout = "";
      let stderr = "";

      const result: PdfExtractionResult = await new Promise((resolve) => {
        py.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        py.stderr.on("data", (data) => {
          stderr += data.toString();
        });
        py.on("close", (code) => {
          if (code !== 0) {
            console.error(`Pro Supply Python script failed with code ${code}`);
            console.error("Stderr:", stderr);
            resolve({
              success: false,
              error: `Python script exited with code ${code}: ${stderr}`,
            });
            return;
          }

          try {
            // Parse JSON output from Python script
            const lines = stdout.trim().split("\n");
            let jsonStr = "";
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (line.startsWith("{") && line.endsWith("}")) {
                jsonStr = line;
                break;
              }
            }

            if (!jsonStr) {
              resolve({
                success: false,
                error: "No valid JSON found in Python output",
              });
              return;
            }

            const pythonData = JSON.parse(jsonStr);

            if (pythonData.error) {
              resolve({
                success: false,
                error: pythonData.error,
              });
              return;
            }

            // Transform Python output to our expected format
            const parseDecimal = (value: string | number): number => {
              if (!value) return 0;
              if (typeof value === "number") return value;
              const cleaned = value.toString().replace(/[^\d.,-]/g, "");
              return parseFloat(cleaned.replace(",", ".")) || 0;
            };

            const lineItems = (pythonData.order_items || []).map(
              (item: any) => ({
                supplierSku: item.reference || "",
                description: item.description || "",
                quantity: parseDecimal(item.quantity || "0"),
                unitPrice: parseDecimal(item.unit_price || "0"),
                total: parseDecimal(item.total || "0"),
              }),
            );

            const parsedData: ParsedInvoiceData = {
              supplierInfo: {
                name: pythonData.vendor?.name || "Pro Supply",
                address: pythonData.vendor?.address || "",
              },
              invoiceMetadata: {
                invoiceNumber: pythonData.metadata?.invoice_number || "",
                invoiceDate: (() => {
                  const dateStr = pythonData.metadata?.invoice_date;
                  if (!dateStr) return undefined;
                  try {
                    const date = new Date(dateStr);
                    if (isNaN(date.getTime())) {
                      console.warn(
                        `🐍 Invalid date format from Python: "${dateStr}", setting to undefined`,
                      );
                      return undefined;
                    }
                    return date;
                  } catch (e) {
                    console.warn(
                      `🐍 Error parsing date "${dateStr}": ${e}, setting to undefined`,
                    );
                    return undefined;
                  }
                })(),
                currency: "EUR",
                shippingFee: 0,
                total: parseDecimal(pythonData.totals?.total || "0"),
              },
              lineItems,
            };

            console.log(
              `🐍 Pro Supply parsing succeeded with ${lineItems.length} line items`,
            );
            resolve({
              success: true,
              data: parsedData,
            });
          } catch (parseError) {
            console.error("🐍 Error parsing Pro Supply JSON:", parseError);
            resolve({
              success: false,
              error: `Failed to parse JSON output: ${parseError}`,
            });
          }
        });
      });

      return result;
    } catch (error: any) {
      console.error("🐍 Pro Supply Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Pro Supply Python parsing failed",
      };
    }
  }

  /**
   * Parse Nutrimeo invoices using dedicated Python parser
   */
  private async parseNutrimeoInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Nutrimeo-specific Python parser");

      // Execute the Nutrimeo Python parser
      const { spawn } = await import("child_process");
      const path = await import("path");
      const pythonScript = path.join(
        process.cwd(),
        "python/invoice_extractor-nutrimeo.py",
      );

      return new Promise((resolve, reject) => {
        // Use Python from venv to ensure all dependencies are available
        const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
        const pythonProcess = spawn(pythonCmd, [pythonScript, pdfPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";

        pythonProcess.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on("data", (data: any) => {
          stderr += data.toString();
        });

        pythonProcess.on("close", (code: number) => {
          if (code !== 0) {
            console.error(`❌ Nutrimeo Python parser exited with code ${code}`);
            console.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `Nutrimeo Python parser failed with code ${code}: ${stderr}`,
            });
            return;
          }

          try {
            // Parse the JSON output from the Python script
            // The Python script may output debug info before JSON, so extract just the JSON part
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error("No JSON found in Python output");
            }
            const result = JSON.parse(jsonMatch[0]);

            if (result.error) {
              resolve({
                success: false,
                error: result.error,
              });
              return;
            }

            // Convert Python parser output to our expected format
            const parsedData: ParsedInvoiceData = {
              supplierInfo: {
                name: result.supplier || "Nutrimeo",
              },
              invoiceMetadata: {
                invoiceNumber: result.invoice_number,
                invoiceDate: result.invoice_date
                  ? new Date(result.invoice_date)
                  : undefined,
                currency: result.currency || "EUR",
                shippingFee: result.shipping_cost || result.shipping_ht || 0,
                subtotal: result.subtotal_ht,
                total: result.total_amount,
              },
              lineItems:
                result.line_items?.map((item: any) => ({
                  supplierSku: item.reference || "",
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unit_price,
                  total: item.total,
                })) || [],
            };

            console.log(
              `✅ Nutrimeo parser extracted ${parsedData.lineItems.length} line items`,
            );

            resolve({
              success: true,
              data: parsedData,
              warnings: result.validation_errors || [],
            });
          } catch (parseError: any) {
            console.error(
              `❌ Failed to parse Nutrimeo Python output: ${parseError.message}`,
            );
            console.error(`stdout: ${stdout}`);
            resolve({
              success: false,
              error: `Failed to parse Nutrimeo Python output: ${parseError.message}`,
            });
          }
        });
      });
    } catch (error: any) {
      console.error("🐍 Nutrimeo Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nutrimeo Python parsing failed",
      };
    }
  }

  /**
   * Parse DSL Global invoices using dedicated Python parser
   */
  private async parseDslGlobalInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using DSL Global-specific Python parser");

      // Execute the DSL Global Python parser
      const { spawn } = await import("child_process");
      const path = await import("path");
      const pythonScript = path.join(
        process.cwd(),
        "python/invoice_extractor_dsl_global.py",
      );

      return new Promise((resolve, reject) => {
        // Use Python from venv to ensure all dependencies are available
        const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
        const pythonProcess = spawn(pythonCmd, [pythonScript, pdfPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";

        pythonProcess.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on("data", (data: any) => {
          stderr += data.toString();
          console.log(`🐍 Python stderr: ${data}`);
        });

        pythonProcess.on("close", (code: number) => {
          if (code !== 0) {
            console.error(
              `🐍 DSL Global Python parser exited with code ${code}`,
            );
            console.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `DSL Global Python parser exited with code ${code}`,
            });
            return;
          }

          try {
            // Parse the JSON output from the Python script
            const jsonData = JSON.parse(stdout);

            if (jsonData.error) {
              resolve({
                success: false,
                error: jsonData.error,
              });
              return;
            }

            // Convert to our internal format
            const parsedData: ParsedInvoiceData = {
              supplierInfo: {
                name: jsonData.vendor?.name || "DSL Global",
                address: jsonData.vendor?.address || "",
              },
              invoiceMetadata: {
                invoiceNumber: jsonData.metadata?.invoice_number || "",
                invoiceDate: (() => {
                  const dateStr = jsonData.metadata?.invoice_date;
                  if (!dateStr) return undefined;
                  try {
                    const date = new Date(dateStr);
                    if (isNaN(date.getTime())) return undefined;
                    return date;
                  } catch {
                    return undefined;
                  }
                })(),
                currency: "EUR",
                shippingFee: parseFloat(jsonData.totals?.shipping_fee || "0"),
                subtotal: parseFloat(jsonData.totals?.subtotal || "0"),
                total: parseFloat(jsonData.totals?.total || "0"),
              },
              lineItems: (jsonData.order_items || []).map((item: any) => ({
                supplierSku: item.article || item.reference || "",
                description: item.description || "",
                quantity: parseFloat(item.quantity || "0"),
                unitPrice: parseFloat(item.unit_price || "0"),
                total: parseFloat(item.net_total || item.total || "0"),
              })),
            };

            resolve({
              success: true,
              data: parsedData,
            });
          } catch (parseError: any) {
            console.error(
              `❌ Failed to parse DSL Global Python output: ${parseError.message}`,
            );
            console.error(`stdout: ${stdout}`);
            resolve({
              success: false,
              error: `Failed to parse DSL Global Python output: ${parseError.message}`,
            });
          }
        });
      });
    } catch (error: any) {
      console.error("🐍 DSL Global Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "DSL Global Python parsing failed",
      };
    }
  }

  /**
   * Parse Novoma invoices using dedicated Python parser
   */
  private async parseNovomaInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Novoma-specific Python parser");

      // Execute the Novoma Python parser
      const { spawn } = await import("child_process");
      const path = await import("path");
      const pythonScript = path.join(
        process.cwd(),
        "python/invoice_extractor-novoma.py",
      );

      return new Promise((resolve, reject) => {
        // Use Python from venv to ensure all dependencies are available
        const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
        const pythonProcess = spawn(pythonCmd, [pythonScript, pdfPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";

        pythonProcess.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on("data", (data: any) => {
          stderr += data.toString();
        });

        pythonProcess.on("close", (code: number) => {
          if (code !== 0) {
            console.error(`❌ Novoma Python parser exited with code ${code}`);
            console.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `Novoma Python parser failed with code ${code}: ${stderr}`,
            });
            return;
          }

          try {
            // Parse the JSON output from the Python script
            // The Python script may output debug info before JSON, so extract just the JSON part
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error("No JSON found in Python output");
            }
            const result = JSON.parse(jsonMatch[0]);

            if (result.error) {
              resolve({
                success: false,
                error: result.error,
              });
              return;
            }

            // Convert Python parser output to our expected format
            const parsedData: ParsedInvoiceData = {
              supplierInfo: {
                name: result.supplier || "Novoma",
              },
              invoiceMetadata: {
                invoiceNumber: result.invoice_number,
                invoiceDate: result.invoice_date
                  ? new Date(result.invoice_date)
                  : undefined,
                currency: result.currency || "EUR",
                shippingFee: result.shipping_cost || result.shipping_ht || 0,
                subtotal: result.subtotal_ht,
                total: result.total_amount,
              },
              lineItems:
                result.line_items?.map((item: any) => ({
                  supplierSku: item.sku || "",
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unit_price,
                  total: item.total,
                })) || [],
            };

            console.log(
              `✅ Novoma parser extracted ${parsedData.lineItems.length} line items`,
            );

            resolve({
              success: true,
              data: parsedData,
              warnings: result.validation_errors || [],
            });
          } catch (parseError: any) {
            console.error(
              `❌ Failed to parse Novoma Python output: ${parseError.message}`,
            );
            console.error(`stdout: ${stdout}`);
            resolve({
              success: false,
              error: `Failed to parse Novoma Python output: ${parseError.message}`,
            });
          }
        });
      });
    } catch (error: any) {
      console.error("🐍 Novoma Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Novoma Python parsing failed",
      };
    }
  }

  /**
   * Parse Powerbody invoices using dedicated Python parser
   */
  private async parsePowerbodyInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Powerbody-specific Python parser");

      // Execute the Powerbody Python parser
      const { spawn } = await import("child_process");
      const path = await import("path");
      const pythonScript = path.join(
        process.cwd(),
        "python/invoice_extractor_powerbody.py",
      );

      return new Promise((resolve, reject) => {
        // Use Python from venv to ensure all dependencies are available
        const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
        const pythonProcess = spawn(pythonCmd, [pythonScript, pdfPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";

        pythonProcess.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on("data", (data: any) => {
          stderr += data.toString();
          console.log(`🐍 Python stderr: ${data}`);
        });

        pythonProcess.on("close", (code: number) => {
          if (code !== 0) {
            console.error(
              `🐍 Powerbody Python parser exited with code ${code}`,
            );
            console.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `Powerbody Python parser exited with code ${code}`,
            });
            return;
          }

          try {
            // Parse the JSON output from the Python script
            // The script might output info logs before JSON, so extract JSON part
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              // If no JSON block found, try parsing whole stdout (some scripts are clean)
              try {
                const data = JSON.parse(stdout);
                // If successful, proceed with data
                mapAndResolve(data);
                return;
              } catch {
                throw new Error("No JSON found in Python output");
              }
            } else {
              const result = JSON.parse(jsonMatch[0]);
              mapAndResolve(result);
            }

            function mapAndResolve(jsonData: any) {
              if (jsonData.error) {
                resolve({
                  success: false,
                  error: jsonData.error,
                });
                return;
              }

              // Convert to our internal format
              const parsedData: ParsedInvoiceData = {
                supplierInfo: {
                  name: jsonData.supplier || "Powerbody",
                },
                invoiceMetadata: {
                  invoiceNumber: jsonData.invoice_number || "",
                  invoiceDate: undefined, // Powerbody parser output doesn't seem to have date in the example
                  currency: jsonData.currency || "EUR",
                  shippingFee: 0, // Not explicitly in the example output
                  subtotal: parseFloat(jsonData.total_amount || "0"),
                  total: parseFloat(jsonData.total_amount || "0"),
                },
                lineItems: (jsonData.line_items || []).map((item: any) => ({
                  supplierSku: item.sku || "",
                  description: item.description || item.manufacturer || "",
                  quantity: parseFloat(item.quantity || "0"),
                  unitPrice: parseFloat(item.unit_price || "0"),
                  total: parseFloat(item.total || "0"),
                })),
              };

              resolve({
                success: true,
                data: parsedData,
              });
            }
          } catch (parseError: any) {
            console.error(
              `❌ Failed to parse Powerbody Python output: ${parseError.message}`,
            );
            console.error(`stdout: ${stdout}`);
            resolve({
              success: false,
              error: `Failed to parse Powerbody Python output: ${parseError.message}`,
            });
          }
        });
      });
    } catch (error: any) {
      console.error("🐍 Powerbody Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Powerbody Python parsing failed",
      };
    }
  }

  /**
   * Parse Nutrimea invoices using dedicated Python parser
   */
  private async parseNutrimeaInvoice(
    pdfPath: string,
  ): Promise<PdfExtractionResult> {
    try {
      console.log("🐍 Using Nutrimea-specific Python parser");

      // Execute the Nutrimea Python parser
      const { spawn } = await import("child_process");
      const path = await import("path");
      const pythonScript = path.join(
        process.cwd(),
        "python/invoice_extractor-nutrimea.py",
      );

      return new Promise((resolve, reject) => {
        // Use Python from venv to ensure all dependencies are available
        const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
        const pythonProcess = spawn(pythonCmd, [pythonScript, pdfPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";

        pythonProcess.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on("data", (data: any) => {
          stderr += data.toString();
        });

        pythonProcess.on("close", (code: number) => {
          if (code !== 0) {
            console.error(`❌ Nutrimea Python parser exited with code ${code}`);
            console.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `Nutrimea Python parser failed with code ${code}: ${stderr}`,
            });
            return;
          }

          try {
            // Parse the JSON output from the Python script
            // The Python script may output debug info before JSON, so extract just the JSON part
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error("No JSON found in Python output");
            }
            const result = JSON.parse(jsonMatch[0]);

            if (result.error) {
              resolve({
                success: false,
                error: result.error,
              });
              return;
            }

            // Convert Python parser output to our expected format
            const parsedData: ParsedInvoiceData = {
              supplierInfo: {
                name: result.supplier || "Nutrimea",
              },
              invoiceMetadata: {
                invoiceNumber: result.invoice_number,
                invoiceDate: result.invoice_date
                  ? new Date(result.invoice_date)
                  : undefined,
                currency: result.currency || "EUR",
                shippingFee: parseFloat(result.shipping_cost || result.shipping_ht) || 0,
                subtotal: parseFloat(result.subtotal_ht) || 0,
                total: parseFloat(result.total_amount) || 0,
              },
              lineItems:
                result.line_items?.map((item: any) => ({
                  supplierSku: item.reference || "",
                  description: item.description,
                  quantity: parseInt(item.quantity) || 0,
                  unitPrice: parseFloat(item.unit_price) || 0,
                  total: parseFloat(item.total) || 0,
                })) || [],
            };

            console.log(
              `✅ Nutrimea parser extracted ${parsedData.lineItems.length} line items`,
            );

            resolve({
              success: true,
              data: parsedData,
              warnings: result.validation_errors || [],
            });
          } catch (parseError: any) {
            console.error(
              `❌ Failed to parse Nutrimea Python output: ${parseError.message}`,
            );
            console.error(`stdout: ${stdout}`);
            resolve({
              success: false,
              error: `Failed to parse Nutrimea Python output: ${parseError.message}`,
            });
          }
        });
      });
    } catch (error: any) {
      console.error("🐍 Nutrimea Python parsing failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Nutrimea Python parsing failed",
      };
    }
  }
}
