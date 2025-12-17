class MiddlewareTest {
  static async getSheetsId(): Promise<string | undefined> {
    try {
      const fs = await import("fs");
      const { PATHS } = await import("../../../utils/storage.server");
      const settingsPath = PATHS.GOOGLE_SETTINGS;

      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(content);
        return settings.spreadsheetId;
      }
    } catch (error) {
      console.error("Error loading spreadsheet ID:", error);
    }
    return undefined;
  }

  static transormDataToString(
    sheetData: { values: Array<Array<string | number | boolean>> } | null
  ): string[] {
    if (!sheetData || !sheetData.values) {
      return [];
    }
    return sheetData.values.map((row: any[]) => {
      const value = row[0];
      return String(value || "").trim();
    });
  }
  static normalizeSku(sku: string): string {
    return sku
      .toUpperCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^A-Z0-9\-]/g, "")
      .trim();
  }

  static calculatePriceUnitWithShipping(
    invoiceItems: Array<{
      invoice_sku: string;
      qty: number;
      unit_price: number;
    }>,
    totalShipping: number
  ): Array<{ invoice_sku: string; qty: number; unit_price: number }> {
    const totalInvoiceQty = invoiceItems.reduce(
      (sum, item) => sum + item.qty,
      0
    );

    const shipping_per_unit =
      totalInvoiceQty > 0 ? totalShipping / totalInvoiceQty : 0;

    for (const item of invoiceItems) {
      item.unit_price = item.unit_price + shipping_per_unit;
    }

    return invoiceItems;
  }
}
export default MiddlewareTest;

