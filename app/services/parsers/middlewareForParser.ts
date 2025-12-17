import { spawn } from "child_process";
import { join } from "path";

class MiddlewareForParser {
  static createPathToPython() {
    const isWindows = process.platform === "win32";
    if (isWindows) {
      return join(process.cwd(), "python", "venv", "Scripts", "python.exe");
    } else {
      // Linux, macOS, and other Unix-like systems
      return join(process.cwd(), "python", "venv", "bin", "python3");
    }
  }

  static getSupplierConfigPath(supplierName: string): string | null {
    const normalizedName = supplierName.toLowerCase().trim();
    const configMap: { [key: string]: string } = {
      addict: "addict.json",
      bolero: "bolero.json",
      dynveo: "dynveo.json",
      "essential supp": "essential_supp.json",
      maiavie: "essential_supp.json", // Maiavie uses Essential Supp config
      inlead: "inlead.json",
      nakosport: "nakosport.json",
      naskorsports: "nakosport.json", // NASKORSPORTS uses nakosport config
      nutrimea: "nutrimea.json",
      nutrimeo: "nutrimeo.json",
      buchsteiner: "buchsteiner.json",
      buchteiner: "buchsteiner.json", // Alternative spelling
      "dsl global": "dsl_global.json",
      "pro supply": "pro_supply.json",
      "shaker store": "shaker_store.json",
      ostrovit: "ostrovit.json",
      powerbody: "powerbody.json",
      prolife: "prolife.json",
      "io genix": "io_genix.json",
      "life pro": "life_pro.json",
      "max protein": "max_protein.json",
      "pb wholesale": "pb_wholesale.json",
      "ingredient superfood": "ingredient_superfood.json",
      labz: "labz.json",
      liot: "liot.json",
      rabeko: "rabeko.json",
      swanson: "swanson.json",
      yamamoto: "yamamoto.json",
      novoma: "novoma.json",
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

  static spawnPython(
    pythonCmd: string,
    configPath: string,
    pdfFilePath: string
  ) {
    const isWindows = process.platform === "win32";
    const args = [
      "-m",
      "python.unified_parser.main",
      "--config",
      configPath,
      "--pdf",
      pdfFilePath,
      "--json",
    ];
    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
    };
    if (isWindows) {
      return spawn(pythonCmd, args, { cwd: process.cwd(), env });
    } else {
      return spawn(pythonCmd, args, { cwd: process.cwd() });
    }
  }
}

export default MiddlewareForParser;
