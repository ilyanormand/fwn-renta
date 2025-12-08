import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getInvoiceById } from "../utils/invoice.server";

// Load Google Sheets settings
async function loadGoogleSheetsSettings() {
  try {
    const fs = await import('fs');
    const { PATHS } = await import('../utils/storage.server');
    const settingsPath = PATHS.GOOGLE_SETTINGS;
    
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log('Google Sheets settings file not found');
  }
  return {};
}

// Get SKU FWN from Google Sheets by matching invoice SKU
async function getSkuFwnMapping(invoiceSkus: string[], sheetsService: any, spreadsheetId: string) {
  try {
    // Read columns E (invoice SKU) and B (SKU FWN) from Google Sheets
    const range = 'Sheet1!B2:E1000'; // Adjust range as needed
    const sheetData = await sheetsService.readData(spreadsheetId, range);
    
    if (!sheetData || !sheetData.values) {
      console.log('No data found in Google Sheets');
      return new Map();
    }
    
    // Build mapping: invoice SKU (E) -> SKU FWN (B)
    const mapping = new Map<string, string>();
    
    for (const row of sheetData.values) {
      if (row.length >= 4) {
        const skuFwn = row[0]; // Column B
        const invoiceSku = row[3]; // Column E
        
        if (invoiceSku && skuFwn) {
          // Normalize SKU for matching (trim, uppercase)
          const normalizedInvoiceSku = invoiceSku.toString().trim().toUpperCase();
          mapping.set(normalizedInvoiceSku, skuFwn.toString());
        }
      }
    }
    
    console.log(`-----> Built SKU FWN mapping for ${mapping.size} SKUs`);
    return mapping;
  } catch (error) {
    console.error('Error reading Google Sheets:', error);
    return new Map();
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const invoiceId = params.invoiceId;
  
  if (!invoiceId) {
    return new Response("Invoice ID is required", { status: 400 });
  }
  
  try {
    // Get invoice from database
    const invoice = await getInvoiceById(invoiceId);
    
    if (!invoice) {
      return new Response("Invoice not found", { status: 404 });
    }
    
    // Load Google Sheets settings
    const settings = await loadGoogleSheetsSettings();
    
    if (!settings.spreadsheetId) {
      return new Response("Google Sheets not configured", { status: 500 });
    }
    
    // Get sheets service
    let sheetsService;
    
    if (settings.serviceAccountConfig) {
      const { createServiceAccountServiceFromConfig } = await import("../services/googleSheets.server");
      sheetsService = createServiceAccountServiceFromConfig(settings.serviceAccountConfig);
    } else if (settings.oauth2Config && settings.oauth2Tokens) {
      const { createOAuth2ServiceFromConfig } = await import("../services/googleSheets.server");
      const tokens = JSON.parse(settings.oauth2Tokens);
      sheetsService = createOAuth2ServiceFromConfig(settings.oauth2Config, tokens.access_token);
    } else {
      return new Response("Google Sheets authentication not configured", { status: 500 });
    }
    
    // Get SKU FWN mapping from Google Sheets
    const invoiceSkus = invoice.items.map((item: any) => item.sku.trim().toUpperCase());
    const skuFwnMapping = await getSkuFwnMapping(invoiceSkus, sheetsService, settings.spreadsheetId);
    
    // Prepare data for Excel
    const excelData: Array<{ skuFwn: string; quantity: number }> = [];
    
    for (const item of invoice.items) {
      const normalizedSku = item.sku.trim().toUpperCase();
      const skuFwn = skuFwnMapping.get(normalizedSku);
      
      if (skuFwn) {
        excelData.push({
          skuFwn: skuFwn,
          quantity: item.quantity
        });
      } else {
        console.log(`Warning: SKU FWN not found for invoice SKU: ${item.sku}`);
        // Still add it but with the original SKU
        excelData.push({
          skuFwn: item.sku,
          quantity: item.quantity
        });
      }
    }
    
    // Generate Excel file using xlsx (SheetJS)
    const XLSX = await import('xlsx');
    
    // Prepare data in array format for xlsx
    // First row: headers
    const worksheetData = [
      ['', 'SKU FWN', 'Quantity'] // Column A is empty, B is SKU FWN, C is Quantity
    ];
    
    // Add data rows
    excelData.forEach(row => {
      worksheetData.push([
        '', // Column A (empty)
        row.skuFwn, // Column B
        row.quantity // Column C
      ]);
    });
    
    // Create worksheet from array
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 5 },  // Column A width
      { wch: 20 }, // Column B width (SKU FWN)
      { wch: 15 }  // Column C width (Quantity)
    ];
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoice Export');
    
    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Return as downloadable file
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="invoice_${invoiceId}_export.xlsx"`,
      },
    });
    
  } catch (error: any) {
    console.error('Error generating Excel:', error);
    return new Response(`Error generating Excel: ${error.message}`, { status: 500 });
  }
};

