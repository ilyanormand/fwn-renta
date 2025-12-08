import PDFParser from "pdf2json";
import { join } from "path";
import { spawn } from "child_process";

// Types for parsed invoice data
export interface ParsedInvoiceData {
  supplierInfo: {
    name?: string;
    address?: string;
    vatNumber?: string;
  };
  invoiceMetadata: {
    invoiceNumber?: string;
    invoiceDate?: Date;
    currency: string;
    shippingFee: number;
    discount?: number;
    tax?: number;
    subtotal?: number;
    total?: number;
  };
  lineItems: {
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  rawText?: string[]; // For debugging
}

export interface PdfExtractionResult {
  success: boolean;
  data?: ParsedInvoiceData;
  error?: string;
  warnings?: string[];
}

// Helper to map supplier names to config files
function getSupplierConfigPath(supplierName: string): string | null {
  const normalizedName = supplierName.toLowerCase().trim();
  const configMap: { [key: string]: string } = {
    "addict": "addict.json",
    "bolero": "bolero.json",
    "dynveo": "dynveo.json",
    "essential supp": "essential_supp.json",
    "maiavie": "essential_supp.json", // Maiavie uses Essential Supp config
    "inlead": "inlead.json",
    "nakosport": "nakosport.json",
    "naskorsports": "nakosport.json", // NASKORSPORTS uses nakosport config
    "nutrimea": "nutrimea.json",
    "nutrimeo": "nutrimeo.json",
    "buchsteiner": "buchsteiner.json",
    "buchteiner": "buchsteiner.json", // Alternative spelling
    "dsl global": "dsl_global.json",
    "pro supply": "pro_supply.json",
    "shaker store": "shaker_store.json",
    "ostrovit": "ostrovit.json",
    "powerbody": "powerbody.json",
    "prolife": "prolife.json",
    "io genix": "io_genix.json",
    "life pro": "life_pro.json",
    "max protein": "max_protein.json",
    "pb wholesale": "pb_wholesale.json",
    "ingredient superfood": "ingredient_superfood.json",
    "labz": "labz.json",
    "liot": "liot.json",
    "rabeko": "rabeko.json",
    "swanson": "swanson.json",
    "yamamoto": "yamamoto.json",
    "novoma": "novoma.json",
    // Add more mappings as needed
  };

  // Try exact match first
  if (configMap[normalizedName]) {
    return join(process.cwd(), "python/configs", configMap[normalizedName]);
  }

  // Try partial match
  for (const [key, filename] of Object.entries(configMap)) {
    if (normalizedName.includes(key)) {
      return join(process.cwd(), "python/configs", filename);
    }
  }

  return null;
}

// Extract structured text from PDF using pdf2json
export async function extractStructuredText(pdfFilePath: string): Promise<{
  success: boolean;
  textLines?: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>;
  error?: string;
}> {
  return new Promise((resolve) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (errData) => {
      console.error("PDF Parser Error:", errData.parserError);
      resolve({
        success: false,
        error: errData.parserError?.toString() || "PDF parsing failed",
      });
    });

    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        const allTexts: Array<{
          x: number;
          y: number;
          text: string;
          fontSize?: number;
          page: number;
        }> = [];

        // Extract all text elements with positions
        pdfData.Pages.forEach((page, pageIndex) => {
          if (page.Texts) {
            page.Texts.forEach((textBlock) => {
              if (textBlock.R) {
                textBlock.R.forEach((run) => {
                  const decodedText = decodeURIComponent(run.T);
                  if (decodedText.trim()) {
                    allTexts.push({
                      x: textBlock.x,
                      y: textBlock.y,
                      text: decodedText,
                      fontSize: run.TS ? run.TS[1] : undefined,
                      page: pageIndex + 1,
                    });
                  }
                });
              }
            });
          }
        });

        // Group text by Y coordinate (lines)
        const tolerance = 0.5;
        const lineGroups: { [key: number]: typeof allTexts } = {};

        allTexts.forEach((item) => {
          const roundedY = Math.round(item.y / tolerance) * tolerance;
          if (!lineGroups[roundedY]) {
            lineGroups[roundedY] = [];
          }
          lineGroups[roundedY].push(item);
        });

        // Convert to sorted lines
        const textLines = Object.keys(lineGroups)
          .map((y) => ({
            yPosition: parseFloat(y),
            items: lineGroups[parseFloat(y)].sort((a, b) => a.x - b.x),
            text: lineGroups[parseFloat(y)]
              .sort((a, b) => a.x - b.x)
              .map((t) => t.text)
              .join(" ")
              .trim(),
          }))
          .filter((line) => line.text.length > 0)
          .sort((a, b) => a.yPosition - b.yPosition);

        resolve({
          success: true,
          textLines,
        });
      } catch (error) {
        console.error("Error processing PDF data:", error);
        resolve({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to process PDF data",
        });
      }
    });

    pdfParser.loadPDF(pdfFilePath);
  });
}

// Main parsing function that delegates to the unified parser
export async function parseInvoiceFromPdf(
  pdfFilePath: string,
  supplierName: string,
  usePythonParser: boolean = true, // Default to true now
): Promise<PdfExtractionResult> {
  console.log(
    `🔍 PDF PARSING START - File: ${pdfFilePath}, Supplier: "${supplierName}"`,
  );

  // 1. Identify Config File
  const configPath = getSupplierConfigPath(supplierName);

  if (!configPath) {
    console.warn(`⚠️ No configuration found for supplier: "${supplierName}". Falling back to legacy/default parsing.`);
    // Fallback to default parsing (or return error if strict)
    // For now, let's return an error to encourage config creation, or maybe fallback to a generic strategy?
    // Given the user wants to use the new parser, we should probably try to use it if possible, 
    // but without a config it won't work.
    // Let's try to see if we can use a default config or just fail gracefully.
    return {
      success: false,
      error: `No configuration found for supplier: ${supplierName}`,
    };
  }

  console.log(`📄 Using config: ${configPath}`);

  try {
    // 2. Call Unified Parser
    const pythonCmd = join(process.cwd(), "python/venv/bin/python3");
    const scriptPath = join(process.cwd(), "python/unified_parser/main.py"); // Use module execution if possible, or script path

    // We'll run it as a module: python -m python.unified_parser.main
    const args = [
      "-m",
      "python.unified_parser.main",
      "--config",
      configPath,
      "--pdf",
      pdfFilePath,
      "--json"
    ];

    console.log(`🚀 Executing: ${pythonCmd} ${args.join(" ")}`);

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
          console.error(`Unified parser failed with code ${code}`);
          console.error("Stderr:", stderr);
          resolve({
            success: false,
            error: `Unified parser exited with code ${code}: ${stderr}`,
          });
          return;
        }

        try {
          // 3. Parse JSON Output
          // The output might contain logs, so we need to extract the JSON part
          // Assuming the script prints ONLY JSON to stdout when --json is used, 
          // but let's be safe and look for the first '{' and last '}'
          const jsonStartIndex = stdout.indexOf('{');
          const jsonEndIndex = stdout.lastIndexOf('}');

          if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            console.error("No JSON found in output:", stdout);
            resolve({
              success: false,
              error: "No JSON output received from parser"
            });
            return;
          }

          const jsonStr = stdout.substring(jsonStartIndex, jsonEndIndex + 1);
          console.log(`🔍 DEBUG: Extracted JSON string length: ${jsonStr.length}`);
          // console.log(`🔍 DEBUG: JSON content: ${jsonStr.substring(0, 200)}...`); 

          const parsedData = JSON.parse(jsonStr);
          console.log(`🔍 DEBUG: Parsed totals:`, parsedData.totals);


          if (parsedData.error) {
            resolve({
              success: false,
              error: parsedData.error
            });
            return;
          }

          // 4. Map to ParsedInvoiceData
          const invoiceData: ParsedInvoiceData = {
            supplierInfo: {
              name: parsedData.vendor?.name,
              address: parsedData.vendor?.address,
              vatNumber: parsedData.vendor?.vat_number,
            },
            invoiceMetadata: {
              invoiceNumber: parsedData.metadata?.invoice_number,
              invoiceDate: parsedData.metadata?.invoice_date ? new Date(parsedData.metadata.invoice_date) : undefined,
              currency: parsedData.vendor?.currency || "EUR",
              shippingFee: parseFloat(parsedData.totals?.shipping_fee || "0"),
              discount: parseFloat(parsedData.totals?.credit || parsedData.totals?.discount || "0"),
              tax: parseFloat(parsedData.totals?.tax || "0") || (
                (parsedData.totals?.total && parsedData.totals?.subtotal && parseFloat(parsedData.totals.total) > parseFloat(parsedData.totals.subtotal))
                ? Math.max(0, (parseFloat(parsedData.totals.total) - parseFloat(parsedData.totals.subtotal)) - parseFloat(parsedData.totals?.shipping_fee || "0"))
                : 0
              ),
              subtotal: parseFloat(parsedData.totals?.subtotal || "0"),
              total: parseFloat(parsedData.totals?.total || "0"),
            },
            lineItems: (parsedData.order_items || []).map((item: any) => ({
              supplierSku: item.sku || item.reference || "",
              description: item.description || "",
              quantity: parseFloat(item.quantity || "0"),
              unitPrice: parseFloat(item.unit_price || "0"),
              total: parseFloat(item.total || "0"),
            })),
          };

          resolve({
            success: true,
            data: invoiceData,
          });

        } catch (e) {
          console.error("Failed to parse JSON output:", e);
          resolve({
            success: false,
            error: `Failed to parse parser output: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      });
    });

    return result;

  } catch (error) {
    console.error("Unified parser execution error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error executing parser",
    };
  }
}
