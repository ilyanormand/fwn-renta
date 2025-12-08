import type { InvoiceParser } from "../pdfParsing.server";

/**
 * Factory class for managing invoice parsers
 * Handles both JavaScript and Python parser selection
 */
export class ParserFactory {
  /**
   * Get a JavaScript parser for the given supplier
   * Returns null if no JavaScript parser is available
   */
  static getParser(supplierName: string): InvoiceParser | null {
    const normalizedName = supplierName.toLowerCase().trim();

    // Currently no JavaScript parsers are implemented
    // This is where specific JavaScript parsers would be registered
    // Example:
    // if (normalizedName.includes('yamamoto') || normalizedName.includes('iaf')) {
    //   return new YamamotoParser();
    // }
    // if (normalizedName.includes('bolero')) {
    //   return new BoleroParser();
    // }

    return null;
  }

  /**
   * Get the parser type for the given supplier
   * Returns 'python' for suppliers that use Python parsing, null otherwise
   */
  static getParserType(supplierName: string): "python" | null {
    const normalizedName = supplierName.toLowerCase().trim();

    // Suppliers that use Python parsing
    const pythonSuppliers = [
      "nutrimeo",
      "dynveo",
      "life pro",
      "dsl global",
      "buchteiner",
      "shaker store",
      "prolife",
      "yamamoto",
      "swanson",
      "rabeko",
      "powerbody",
      "novoma",
      "nutrimea",
    ];

    for (const supplier of pythonSuppliers) {
      if (normalizedName.includes(supplier)) {
        return "python";
      }
    }

    return null;
  }

  /**
   * Check if a supplier has any parser available (JavaScript or Python)
   */
  static hasParser(supplierName: string): boolean {
    return (
      this.getParser(supplierName) !== null ||
      this.getParserType(supplierName) === "python"
    );
  }

  /**
   * Get list of all supported suppliers
   */
  static getSupportedSuppliers(): string[] {
    return [
      "Nutrimeo",
      "Dynveo",
      "Life Pro",
      "DSL Global",
      "Buchteiner",
      "Shaker Store",
      "Prolife",
      "Yamamoto",
      "Swanson",
      "Rabeko",
      "Powerbody",
      "Novoma",
      "Nutrimea",
    ];
  }
}
