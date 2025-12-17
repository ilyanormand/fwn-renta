import PDFParser from "pdf2json";
import MiddlewareForParser from "./middlewareForParser";

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

// Main parsing function that delegates to the unified parser
export async function parseInvoiceFromPdf(
  pdfFilePath: string,
  supplierName: string,
  usePythonParser: boolean = true // Default to true now
): Promise<PdfExtractionResult> {
  console.log(
    `🔍 PDF PARSING START - File: ${pdfFilePath}, Supplier: "${supplierName}"`
  );

  // 1. Validate config exists
  const configPath = validateConfig(supplierName);
  if (!configPath) {
    return {
      success: false,
      error: `No configuration found for supplier: ${supplierName}`,
    };
  }

  try {
    // 2. Execute Python parser
    const result = await executePythonParser(pdfFilePath, configPath);
    return result;
  } catch (error) {
    console.error("Unified parser execution error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error executing parser",
    };
  }
}

// Validate config path exists for supplier
function validateConfig(supplierName: string): string | null {
  const configPath = MiddlewareForParser.getSupplierConfigPath(supplierName);
  if (!configPath) {
    console.warn(
      `⚠️ No configuration found for supplier: "${supplierName}". Falling back to legacy/default parsing.`
    );
    return null;
  }
  console.log(`📄 Using config: ${configPath}`);
  return configPath;
}

// Execute Python parser and handle process output
async function executePythonParser(
  pdfFilePath: string,
  configPath: string
): Promise<PdfExtractionResult> {
  const pythonCmd = MiddlewareForParser.createPathToPython();
  console.log(`🚀 Using Python: ${pythonCmd}`);
  const py = MiddlewareForParser.spawnPython(
    pythonCmd,
    configPath,
    pdfFilePath
  );
  console.log(`🚀 Python process spawned (PID: ${py.pid})`);

  let stdout = "";
  let stderr = "";

  return new Promise((resolve) => {
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
        // Extract JSON from output
        const jsonStr = extractJsonFromOutput(stdout);
        if (!jsonStr) {
          console.error("No JSON found in output:", stdout);
          resolve({
            success: false,
            error: "No JSON output received from parser",
          });
          return;
        }

        console.log(
          `🔍 DEBUG: Extracted JSON string length: ${jsonStr.length}`
        );

        const parsedData = JSON.parse(jsonStr);
        console.log(`🔍 DEBUG: Parsed totals:`, parsedData.totals);

        if (parsedData.error) {
          resolve({
            success: false,
            error: parsedData.error,
          });
          return;
        }

        // Map to ParsedInvoiceData
        const invoiceData = mapPythonOutputToInvoiceData(parsedData);

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
}

// Extract JSON string from Python stdout (handles logs mixed with JSON)
function extractJsonFromOutput(stdout: string): string | null {
  const jsonStartIndex = stdout.indexOf("{");
  const jsonEndIndex = stdout.lastIndexOf("}");

  if (jsonStartIndex === -1 || jsonEndIndex === -1) {
    return null;
  }

  return stdout.substring(jsonStartIndex, jsonEndIndex + 1);
}

// Map Python parser output to ParsedInvoiceData
function mapPythonOutputToInvoiceData(parsedData: any): ParsedInvoiceData {
  return {
    supplierInfo: {
      name: parsedData.vendor?.name,
      address: parsedData.vendor?.address,
      vatNumber: parsedData.vendor?.vat_number,
    },
    invoiceMetadata: {
      invoiceNumber: parsedData.metadata?.invoice_number,
      invoiceDate: parsedData.metadata?.invoice_date
        ? new Date(parsedData.metadata.invoice_date)
        : undefined,
      currency: parsedData.vendor?.currency || "EUR",
      shippingFee: parseFloat(parsedData.totals?.shipping_fee || "0"),
      discount: parseFloat(
        parsedData.totals?.credit || parsedData.totals?.discount || "0"
      ),
      tax:
        parseFloat(parsedData.totals?.tax || "0") ||
        (parsedData.totals?.total &&
        parsedData.totals?.subtotal &&
        parseFloat(parsedData.totals.total) >
          parseFloat(parsedData.totals.subtotal)
          ? Math.max(
              0,
              parseFloat(parsedData.totals.total) -
                parseFloat(parsedData.totals.subtotal) -
                parseFloat(parsedData.totals?.shipping_fee || "0")
            )
          : 0),
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
}

// Extract structured text from PDF using pdf2json (for debugging/development)
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
