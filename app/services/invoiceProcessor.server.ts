// Invoice processing service for Google Sheets integration
// Implements CMP calculation and batch updates according to specification

export interface InvoiceItem {
  invoice_sku: string;
  qty: number;
  unit_price: number;
  shipping_cost_per_item?: number; // Calculated shipping cost for this item
}

export interface ProcessingConfig {
  spreadsheetId: string;
  tabName: string;
  cols: {
    invoice: string;      // E - invoice_skus
    cmp: string;          // G - CMP (current weighted average)
    qprev: string;        // H - Q_prev (quantity before arrival)
    qin: string;          // I - Q_in (quantity from current invoice)
    unit_price_old: string; // J - previous unit price
    unit_price_new: string; // K - new unit price
    shipping_cost: string;  // L - shipping cost per item
  };
  startRow: number;       // 2 (row 1 is headers)
  rounding: {
    sheetScale: number;   // 2 decimal places
  };
  batch: {
    size: number;         // 500 operations per batch
  };
  sku: {
    normalize: {
      uppercase: boolean;
      strip_spaces: boolean;
      split_regex: string; // "[,;/|]"
    };
  };
}

export interface ProcessingResult {
  processed: number;
  updated: number;
  skipped: number;
  notFound: string[];
  ambiguous: string[];
  errors: string[];
  report: string;
}

export interface SheetRow {
  rowIndex: number;
  sku_fwn: string;  // B - SKU FWN for Shopify inventory lookup
  invoice_skus: string;
  cmp: number | null;
  qprev: number;
  qin: number | null;
  unit_price_old: number | null;
  unit_price_new: number | null;
  // Optional fields for storing values for CMP calculation (after PHASE 1 update)
  qprev_old?: number;              // H value for CMP (Quantité ancien)
  qin_new?: number;                // I value for CMP (Quantité nouveau)
  unit_price_old_before?: number | null;  // J value for CMP (Price ancien)
  unit_price_new_after?: number;   // K value for CMP (Price nouveau)
}

export class InvoiceProcessor {
  private config: ProcessingConfig;

  constructor(config: ProcessingConfig) {
    this.config = config;
  }

  // Get current inventory quantity from Shopify by SKU FWN
  private async getShopifyInventoryBySku(admin: any, sku: string): Promise<number> {
    try {
      // Query to find product variant by SKU and get inventory quantity
      const response = await admin.graphql(
        `#graphql
        query getProductVariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            edges {
              node {
                id
                sku
                inventoryQuantity
              }
            }
          }
        }`,
        {
          variables: {
            query: `sku:${sku}`,
          },
        }
      );
      
      const json = await response.json();
      
      if (json.data?.productVariants?.edges?.length > 0) {
        const variant = json.data.productVariants.edges[0].node;
        console.log(`       Found Shopify inventory for SKU ${sku}: ${variant.inventoryQuantity}`);
        return variant.inventoryQuantity || 0;
      }
      
      console.log(`       No Shopify inventory found for SKU: ${sku}`);
      return 0;
    } catch (error) {
      console.error(`       Error fetching Shopify inventory for SKU ${sku}:`, error);
      return 0;
    }
  }

  // Normalize SKU for matching
  private normalizeSku(sku: string): string {
    let normalized = sku.trim();
    
    if (this.config.sku.normalize.strip_spaces) {
      normalized = normalized.replace(/\s+/g, ' ');
    }
    
    if (this.config.sku.normalize.uppercase) {
      normalized = normalized.toUpperCase();
    }
    
    return normalized;
  }

  // Split and normalize SKUs from a cell (E column)
  private parseInvoiceSkus(cellValue: string): string[] {
    if (!cellValue) return [];
    
    console.log(`-----> Parsing cell value: "${cellValue}"`);
    const regex = new RegExp(this.config.sku.normalize.split_regex, 'g');
    const splitSkus = cellValue.split(regex);
    console.log(`-----> Split SKUs:`, splitSkus);
    
    const normalizedSkus = splitSkus
      .map(sku => this.normalizeSku(sku))
      .filter(sku => sku.length > 0);
    
    console.log(`-----> Normalized SKUs:`, normalizedSkus);
    return normalizedSkus;
  }

  // Build mapping from normalized SKU to row index
  private buildSkuMapping(sheetData: any[][]): Map<string, number[]> {
    const mapping = new Map<string, number[]>();
    
    for (let i = 0; i < sheetData.length; i++) {
      const rowIndex = i + this.config.startRow; // Adjust for 1-based indexing and header
      // Now our range is B:K, so E is at index 3 (B=0, C=1, D=2, E=3)
      const invoiceSkusCell = sheetData[i][3] || ''; // Column E (index 3 in B:K range)
      
      const skus = this.parseInvoiceSkus(invoiceSkusCell);
      
      for (const sku of skus) {
        if (!mapping.has(sku)) {
          mapping.set(sku, []);
        }
        mapping.get(sku)!.push(rowIndex);
      }
    }
    
    return mapping;
  }

  // Calculate new CMP (weighted average)
  // NO ROUNDING - keep full precision (e.g., 1.093232)
  private calculateCMP(qPrev: number, unitPriceOld: number | null, qNouveau: number, unitPriceNew: number): number {
    if (unitPriceOld !== null && qPrev > 0) {
      // Weighted average: (Q_prev * unit_price_old + Q_nouveau * unit_price_new) / (Q_prev + Q_nouveau)
      const newCmp = (qPrev * unitPriceOld + qNouveau * unitPriceNew) / (qPrev + qNouveau);
      return newCmp; // ✅ No rounding - full precision
    } else {
      // No history or no previous price - use new unit price
      return unitPriceNew; // ✅ No rounding - full precision
    }
  }

  // Parse sheet data into structured format
  private parseSheetData(rawData: any[][]): SheetRow[] {
    const rows: SheetRow[] = [];
    
    for (let i = 0; i < rawData.length; i++) {
      const rowIndex = i + this.config.startRow;
      const row = rawData[i];
      
      // Mapping for B:K range (B=0, C=1, D=2, E=3, F=4, G=5, H=6, I=7, J=8, K=9)
      rows.push({
        rowIndex,
        sku_fwn: row[0] || '', // B (index 0 in B:K range) - SKU FWN
        invoice_skus: row[3] || '', // E (index 3 in B:K range)
        cmp: this.parseNumber(row[5]), // G (index 5)
        qprev: this.parseNumber(row[6]) || 0, // H (index 6)
        qin: this.parseNumber(row[7]), // I (index 7)
        unit_price_old: this.parseNumber(row[8]), // J (index 8)
        unit_price_new: this.parseNumber(row[9]), // K (index 9)
      });
    }
    
    return rows;
  }

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }

  // Process invoice items and generate updates
  async processInvoice(
    invoiceItems: InvoiceItem[],
    sheetsService: any, // GoogleSheetsServiceAccountService or similar
    totalShippingFee: number = 0, // Total shipping fee for the entire invoice
    admin?: any // Shopify Admin API for inventory lookup (optional for backward compatibility)
  ): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      processed: 0,
      updated: 0,
      skipped: 0,
      notFound: [],
      ambiguous: [],
      errors: [],
      report: ''
    };

    try {
      console.log(`-----> Processing ${invoiceItems.length} invoice items`);
      console.log(`-----> Total shipping fee: ${totalShippingFee}`);
      
      // Calculate total quantity across all items
      const totalQuantity = invoiceItems.reduce((sum, item) => sum + item.qty, 0);
      console.log(`-----> Total quantity across all items: ${totalQuantity}`);
      
      // Calculate shipping cost per unit (not per line item, but per quantity unit)
      const shippingCostPerUnit = totalQuantity > 0 
        ? totalShippingFee / totalQuantity 
        : 0;
      console.log(`-----> Shipping cost per unit: ${shippingCostPerUnit.toFixed(4)}`);
      
      // Add shipping cost per unit to each item
      // This will be multiplied by quantity when calculating unit price with shipping
      invoiceItems = invoiceItems.map(item => ({
        ...item,
        shipping_cost_per_item: shippingCostPerUnit // Cost per one unit of product
      }));
      
      // Step 1: Read current sheet data (including column B for SKU FWN)
      // We need B (SKU FWN) and E:K (invoice data)
      const range = `${this.config.tabName}!B${this.config.startRow}:${this.config.cols.unit_price_new}`;
      console.log(`-----> Reading sheet range (including SKU FWN): ${range}`);
      
      const sheetData = await sheetsService.readData(this.config.spreadsheetId, range);
      if (!sheetData || !sheetData.values) {
        throw new Error('Failed to read sheet data');
      }

      console.log(`-----> Read ${sheetData.values.length} rows from sheet`);
      console.log(`-----> First few rows:`, sheetData.values.slice(0, 3));
      
      // Step 2: Build SKU mapping
      const skuMapping = this.buildSkuMapping(sheetData.values);
      console.log(`-----> Built SKU mapping for ${skuMapping.size} unique SKUs`);
      
      // Debug: Show all mapped SKUs
      console.log(`-----> All mapped SKUs:`, Array.from(skuMapping.keys()));
      
      // Debug: Show first few B and E column values
      console.log(`-----> First few rows (B=SKU FWN, E=Invoice SKUs):`, 
        sheetData.values.slice(0, 5).map((row: any[]) => ({ B: row[0], E: row[3] })));
      
      // Step 3: Parse sheet data into structured format
      const sheetRows = this.parseSheetData(sheetData.values);
      console.log(`-----> Parsed ${sheetRows.length} sheet rows`);
      console.log(`-----> First parsed row:`, sheetRows[0]);
      
      // Step 4: Process each invoice item (TWO PHASES)
      // PHASE 1: Update H, I, J, K columns first
      const dataUpdates: Array<{range: string, values: any[][], rowIndex: number, sku: string}> = [];
      const rowsToProcess: Array<{rowIndex: number, item: InvoiceItem, sheetRow: SheetRow}> = [];
      
      for (const item of invoiceItems) {
        result.processed++;
        
        const normalizedSku = this.normalizeSku(item.invoice_sku);
        console.log(`-----> Looking for SKU: "${item.invoice_sku}" -> normalized: "${normalizedSku}"`);
        
        const matchingRows = skuMapping.get(normalizedSku) || [];
        console.log(`-----> Found ${matchingRows.length} matching rows for "${normalizedSku}"`);
        
        if (matchingRows.length === 0) {
          result.notFound.push(item.invoice_sku);
          result.skipped++;
          console.log(`-----> SKU not found: ${item.invoice_sku} (normalized: ${normalizedSku})`);
          
          // Debug: Show similar SKUs for troubleshooting
          const similarSkus = Array.from(skuMapping.keys()).filter(sku => 
            sku.includes(normalizedSku.substring(0, 5)) || normalizedSku.includes(sku.substring(0, 5))
          );
          if (similarSkus.length > 0) {
            console.log(`-----> Similar SKUs found:`, similarSkus);
          }
          continue;
        }
        
        if (matchingRows.length > 1) {
          result.ambiguous.push(item.invoice_sku);
          result.skipped++;
          console.log(`-----> Ambiguous SKU: ${item.invoice_sku} found in rows ${matchingRows.join(', ')}`);
          continue;
        }
        
        const rowIndex = matchingRows[0];
        const sheetRow = sheetRows.find(r => r.rowIndex === rowIndex);
        
        if (!sheetRow) {
          result.errors.push(`Sheet row not found for index ${rowIndex}`);
          continue;
        }
        
        // Debug current row data
        console.log(`-----> Row ${rowIndex} data:`, {
          invoice_skus: sheetRow.invoice_skus,
          cmp: sheetRow.cmp,
          qprev: sheetRow.qprev,
          qin: sheetRow.qin,
          unit_price_old: sheetRow.unit_price_old,
          unit_price_new: sheetRow.unit_price_new
        });
        
        // Validate input values
        if (item.qty <= 0) {
          console.log(`-----> Skipping ${item.invoice_sku}: invalid quantity ${item.qty}`);
          result.errors.push(`Invalid quantity for ${item.invoice_sku}: ${item.qty}`);
          continue;
        }
        
        if (item.unit_price < 0) {
          console.log(`-----> Skipping ${item.invoice_sku}: invalid unit price ${item.unit_price}`);
          result.errors.push(`Invalid unit price for ${item.invoice_sku}: ${item.unit_price}`);
          continue;
        }
        
        console.log(`\n-----> PHASE 1: Preparing data updates for ${item.invoice_sku}:`);
        console.log(`       Current state BEFORE update:`);
        console.log(`         H (Quantité ancien): ${sheetRow.qprev}`);
        console.log(`         I (Quantité nouveau): ${sheetRow.qin || 'empty'}`);
        console.log(`         J (Unit price old): ${sheetRow.unit_price_old || 'empty'}`);
        console.log(`         K (Unit price new): ${sheetRow.unit_price_new || 'empty'}`);
        console.log(`         L (Shipping cost): will be updated`);
        
        // ALGORITHM:
        // 0. Update L (shipping_cost) - FIRST!
        // 1. Check K (unit_price_new): if filled -> move to J, then put new price + shipping in K
        // 2. Get current Shopify inventory (using SKU FWN from column B) and put it in H (quantite ancien)
        //    Put new quantity from invoice in I (quantite nouveau)
        // 3. Calculate CMP using H, I, J, K
        
        const shippingCost = item.shipping_cost_per_item || 0;
        const unitPriceWithShipping = item.unit_price + shippingCost;
        
        console.log(`       Shipping calculation:`);
        console.log(`         Base unit price: ${item.unit_price}`);
        console.log(`         Shipping cost per unit: ${shippingCost.toFixed(4)} (total shipping / total qty)`);
        console.log(`         Unit price + shipping: ${unitPriceWithShipping.toFixed(4)}`);
        
        let newQPrev: number;
        let newQIn: number;
        let newUnitPriceOld: number | null;
        let newUnitPriceNew: number;
        
        // Step 1: Handle Unit Prices (K -> J -> K)
        if (sheetRow.unit_price_new !== null && sheetRow.unit_price_new !== undefined) {
          // K is filled, move it to J
          newUnitPriceOld = sheetRow.unit_price_new;
          newUnitPriceNew = unitPriceWithShipping; // Use price with shipping
          console.log(`       Step 1 (Prices): K has value ${sheetRow.unit_price_new}`);
          console.log(`         J -> ${newUnitPriceOld} (from K)`);
          console.log(`         K -> ${newUnitPriceNew.toFixed(2)} (from invoice + shipping)`);
        } else {
          // K is empty, just fill it
          newUnitPriceOld = sheetRow.unit_price_old; // Keep J as is (might be null)
          newUnitPriceNew = unitPriceWithShipping; // Use price with shipping
          console.log(`       Step 1 (Prices): K is empty`);
          console.log(`         J -> ${newUnitPriceOld} (unchanged)`);
          console.log(`         K -> ${newUnitPriceNew.toFixed(2)} (from invoice + shipping)`);
        }
        
        // Step 2: Handle Quantities - Get current Shopify inventory for H
        // H (quantite ancien) should be the CURRENT stock from Shopify, not previous value from I
        newQIn = item.qty; // I always gets the new quantity from invoice
        
        if (admin && sheetRow.sku_fwn) {
          // Get current inventory from Shopify using SKU FWN (column B)
          console.log(`       Step 2 (Quantities): Fetching Shopify inventory for SKU FWN: ${sheetRow.sku_fwn}`);
          newQPrev = await this.getShopifyInventoryBySku(admin, sheetRow.sku_fwn);
          console.log(`         H (quantite ancien) -> ${newQPrev} (current Shopify inventory)`);
          console.log(`         I (quantite nouveau) -> ${newQIn} (from invoice)`);
        } else {
          // Fallback to old behavior if admin not available or SKU FWN is empty
          if (sheetRow.qin !== null && sheetRow.qin !== undefined) {
            newQPrev = sheetRow.qin;
            console.log(`       Step 2 (Quantities - Fallback): I has value ${sheetRow.qin}`);
            console.log(`         H -> ${newQPrev} (from I, no Shopify API)`);
            console.log(`         I -> ${newQIn} (from invoice)`);
          } else {
            newQPrev = sheetRow.qprev;
            console.log(`       Step 2 (Quantities - Fallback): I is empty`);
            console.log(`         H -> ${newQPrev} (unchanged, no Shopify API)`);
            console.log(`         I -> ${newQIn} (from invoice)`);
          }
        }
        
        // Prepare updates
        // IMPORTANT: L (shipping cost) MUST be updated FIRST!
        // L[row] = shipping cost per unit (total shipping / sum of all quantities)
        dataUpdates.push({
          range: `${this.config.tabName}!${this.config.cols.shipping_cost}${rowIndex}`,
          values: [[shippingCost]],
          rowIndex,
          sku: item.invoice_sku
        });
        
        // H[row] = new Q_prev (either from I or unchanged)
        dataUpdates.push({
          range: `${this.config.tabName}!${this.config.cols.qprev}${rowIndex}`,
          values: [[newQPrev]],
          rowIndex,
          sku: item.invoice_sku
        });
        
        // I[row] = new quantity from invoice
        dataUpdates.push({
          range: `${this.config.tabName}!${this.config.cols.qin}${rowIndex}`,
          values: [[newQIn]],
          rowIndex,
          sku: item.invoice_sku
        });
        
        // J[row] = unit price old (either from K or unchanged)
        if (newUnitPriceOld !== null && newUnitPriceOld !== undefined) {
          dataUpdates.push({
            range: `${this.config.tabName}!${this.config.cols.unit_price_old}${rowIndex}`,
            values: [[newUnitPriceOld]],
            rowIndex,
            sku: item.invoice_sku
          });
        }
        
        // K[row] = new unit price from invoice
        dataUpdates.push({
          range: `${this.config.tabName}!${this.config.cols.unit_price_new}${rowIndex}`,
          values: [[newUnitPriceNew]],
          rowIndex,
          sku: item.invoice_sku
        });
        
        // Save for PHASE 2 (CMP calculation)
        // For CMP we need: H (ancien qty), I (nouveau qty), J (ancien price), K (nouveau price)
        // These will be the values AFTER the update above
        rowsToProcess.push({ 
          rowIndex, 
          item, 
          sheetRow: {
            ...sheetRow,
            qprev_old: newQPrev,           // H value after update (Quantité ancien for CMP)
            qin_new: newQIn,               // I value after update (Quantité nouveau for CMP)
            unit_price_old_before: newUnitPriceOld,  // J value after update (Price ancien for CMP)
            unit_price_new_after: newUnitPriceNew     // K value after update (Price nouveau for CMP)
          }
        });
        
        console.log(`-----> Prepared data updates for ${item.invoice_sku} (row ${rowIndex}): L (shipping), H, I, J, K`);
      }
      
      // Step 5: Execute PHASE 1 updates (L, H, I, J, K) and wait for completion
      if (dataUpdates.length > 0) {
        console.log(`\n=====> PHASE 1: Executing ${dataUpdates.length} data updates (L shipping, H, I, J, K columns)`);
        await this.executeBatchUpdates(dataUpdates.map(u => ({ range: u.range, values: u.values })), sheetsService);
        console.log(`=====> PHASE 1: Data updates completed, waiting 2 seconds for Google Sheets to process...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for Google Sheets to process
      } else {
        console.log(`-----> No data updates to execute`);
      }
      
      // Step 6: PHASE 2 - Re-read updated data and calculate CMP
      if (rowsToProcess.length > 0) {
        console.log(`\n=====> PHASE 2: Re-reading sheet data for CMP calculation`);
        
        // Re-read the sheet to get updated H, I, J, K values
        const updatedSheetData = await sheetsService.readData(this.config.spreadsheetId, range);
        if (!updatedSheetData || !updatedSheetData.values) {
          throw new Error('Failed to re-read sheet data for CMP calculation');
        }
        
        const updatedSheetRows = this.parseSheetData(updatedSheetData.values);
        console.log(`=====> Re-read ${updatedSheetRows.length} rows from sheet`);
        
        const cmpUpdates: Array<{range: string, values: any[][]}> = [];
        
        for (const { rowIndex, item, sheetRow } of rowsToProcess) {
          // Get updated row data
          const updatedRow = updatedSheetRows.find(r => r.rowIndex === rowIndex);
          
          if (!updatedRow) {
            console.log(`-----> Warning: Could not find updated row ${rowIndex}, using original data`);
            continue;
          }
          
          console.log(`-----> Row ${rowIndex} updated data from Google Sheets:`, {
            qprev: updatedRow.qprev,
            qin: updatedRow.qin,
            unit_price_old: updatedRow.unit_price_old,
            unit_price_new: updatedRow.unit_price_new
          });
          
          // Use the values calculated in PHASE 1 for CMP calculation
          // After PHASE 1 update:
          // H = Quantité ancien
          // I = Quantité nouveau  
          // J = Unit price ancien
          // K = Unit price nouveau
          const qAncien = sheetRow.qprev_old || 0;
          const qNouveau = sheetRow.qin_new || item.qty;
          const priceAncien = sheetRow.unit_price_old_before !== undefined ? sheetRow.unit_price_old_before : null;
          const priceNouveau = sheetRow.unit_price_new_after || item.unit_price;
          
          console.log(`\n-----> CMP Calculation for ${item.invoice_sku}:`);
          console.log(`       Using values from PHASE 1 (after H,I,J,K update):`);
          console.log(`       ┌─ H (Quantité ancien): ${qAncien}`);
          console.log(`       ├─ I (Quantité nouveau): ${qNouveau}`);
          console.log(`       ├─ J (Unit price ancien): ${priceAncien}`);
          console.log(`       └─ K (Unit price nouveau): ${priceNouveau}`);
          
          // Calculate CMP: (Q_ancien × price_ancien + Q_nouveau × price_nouveau) / (Q_ancien + Q_nouveau)
          const newCmp = this.calculateCMP(
            qAncien,       // H - Quantité ancien
            priceAncien,   // J - Unit price ancien
            qNouveau,      // I - Quantité nouveau
            priceNouveau   // K - Unit price nouveau
          );
          
          // Validate calculated CMP
          if (isNaN(newCmp) || !isFinite(newCmp)) {
            console.log(`       ❌ ERROR: Invalid CMP calculation result: ${newCmp}`);
            result.errors.push(`Invalid CMP calculation for ${item.invoice_sku}: ${newCmp}`);
            continue;
          }
          
          console.log(`       Formula: (${qAncien} × ${priceAncien} + ${qNouveau} × ${priceNouveau}) / (${qAncien} + ${qNouveau})`);
          
          if (priceAncien !== null && qAncien > 0) {
            const numerator = (qAncien * priceAncien) + (qNouveau * priceNouveau);
            const denominator = qAncien + qNouveau;
            console.log(`       Calculation: (${qAncien * priceAncien} + ${qNouveau * priceNouveau}) / ${denominator} = ${numerator} / ${denominator} = ${newCmp}`);
          } else {
            console.log(`       First import - using new unit price: ${newCmp}`);
          }
          
          console.log(`       Old CMP: ${sheetRow.cmp} ➜ New CMP: ${newCmp}`);
          
          // G[row] = CMP_new
          cmpUpdates.push({
            range: `${this.config.tabName}!${this.config.cols.cmp}${rowIndex}`,
            values: [[newCmp]]
          });
          
          result.updated++;
        }
        
        // Step 7: Execute PHASE 2 updates (CMP only)
        if (cmpUpdates.length > 0) {
          console.log(`\n=====> PHASE 2: Executing ${cmpUpdates.length} CMP updates (G column)`);
          await this.executeBatchUpdates(cmpUpdates, sheetsService);
          console.log(`=====> PHASE 2: CMP updates completed`);
        }
      }
      
      // Step 8: Generate report
      result.report = this.generateReport(result, invoiceItems.length);
      
      return result;
      
    } catch (error: any) {
      result.errors.push(`Processing failed: ${error.message}`);
      console.error('-----> Invoice processing error:', error);
      return result;
    }
  }

  // Execute updates in batches to avoid API limits
  private async executeBatchUpdates(updates: Array<{range: string, values: any[][]}>, sheetsService: any): Promise<void> {
    const batchSize = this.config.batch.size;
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      console.log(`-----> Executing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)} (${batch.length} updates)`);
      console.log(`-----> Batch updates:`, batch.map(u => `${u.range}: ${JSON.stringify(u.values)}`));
      
      // Execute updates sequentially to avoid race conditions
      const results = [];
      for (let j = 0; j < batch.length; j++) {
        const update = batch[j];
        try {
          console.log(`-----> Executing update ${j + 1}/${batch.length}: ${update.range} = ${JSON.stringify(update.values)}`);
          
          // Validate values before sending
          const value = update.values[0][0];
          if (value === null || value === undefined) {
            console.log(`-----> Skipping update with null/undefined value: ${update.range}`);
            continue;
          }
          
          // Retry logic for rate limit errors
          let retryCount = 0;
          const maxRetries = 3;
          let result;
          
          while (retryCount <= maxRetries) {
            try {
              result = await sheetsService.updateData(this.config.spreadsheetId, update.range, update.values);
              console.log(`-----> Update ${j + 1} result:`, result);
              break; // Success, exit retry loop
            } catch (retryError: any) {
              if (retryError.message.includes('429') && retryCount < maxRetries) {
                retryCount++;
                const delay = Math.pow(2, retryCount) * 5000; // Much longer exponential backoff: 10s, 20s, 40s
                console.log(`-----> Rate limit hit, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
              } else {
                throw retryError; // Re-throw if not rate limit or max retries reached
              }
            }
          }
          
          results.push(result);
          
          // Much longer delay between individual updates to avoid rate limits (1.5 seconds)
          await new Promise(resolve => setTimeout(resolve, 1500));
          
        } catch (error: any) {
          console.error(`-----> Update ${j + 1} failed for ${update.range}:`, error.message);
          console.error(`-----> Failed update details:`, update);
          // Continue with other updates instead of failing completely
          results.push({ success: false, error: error.message });
        }
      }
      
      console.log(`-----> Batch ${Math.floor(i / batchSize) + 1} completed, results:`, results.map(r => r.success || r.error));
      
      // Much longer delay between batches to avoid rate limits (3 seconds)
      if (i + batchSize < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  // Generate processing report
  private generateReport(result: ProcessingResult, totalItems: number): string {
    const lines = [
      `=== Invoice Processing Report ===`,
      `Total items: ${totalItems}`,
      `Processed: ${result.processed}`,
      `Updated: ${result.updated}`,
      `Skipped: ${result.skipped}`,
      ``,
      `Not found SKUs (${result.notFound.length}):`,
      ...result.notFound.map(sku => `  - ${sku}`),
      ``,
      `Ambiguous SKUs (${result.ambiguous.length}):`,
      ...result.ambiguous.map(sku => `  - ${sku}`),
      ``,
      `Errors (${result.errors.length}):`,
      ...result.errors.map(error => `  - ${error}`)
    ];
    
    return lines.join('\n');
  }
}

// Default configuration
export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  spreadsheetId: '', // Will be set from settings
  tabName: 'Sheet1',
  cols: {
    invoice: 'E',
    cmp: 'G', 
    qprev: 'H',
    qin: 'I',
    unit_price_old: 'J',
    unit_price_new: 'K',
    shipping_cost: 'L'
  },
  startRow: 2,
  rounding: {
    sheetScale: 2
  },
  batch: {
    size: 20  // Very conservative to avoid rate limits
  },
  sku: {
    normalize: {
      uppercase: true,
      strip_spaces: true,
      split_regex: '[,;/|]'
    }
  }
};

// Helper function to create processor with default config
export function createInvoiceProcessor(spreadsheetId: string, customConfig?: Partial<ProcessingConfig>): InvoiceProcessor {
  const config: ProcessingConfig = {
    ...DEFAULT_PROCESSING_CONFIG,
    spreadsheetId,
    ...customConfig
  };
  
  return new InvoiceProcessor(config);
}
