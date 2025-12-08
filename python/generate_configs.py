#!/usr/bin/env python3
"""
Batch config generator for unified parser.
Analyzes existing parser scripts and generates JSON configs.
"""

import json
import re
import os
from pathlib import Path

SUPPLIER_CONFIGS = {
    "novoma": {
        "note": "Uses embedded Factur-X XML - requires special XML extraction strategy (not yet implemented in unified parser)"
    },
    "nutrimea": {
        "vendor": {
            "name": "Nutrimea",
            "currency": "EUR",
            "language": "fr"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Numéro de facture[\\s\\S]{0,50}?(\\d+)", "group": 1},
                {"name": "invoice_date", "regex": "(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["référence", "désignation", "prix", "quantité"],
            "columns": [
                {"name": "reference", "index": 0, "type": "string"},
                {"name": "description", "index": 1, "type": "string"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "quantity", "index": 3, "type": "number"},
                {"name": "total", "index": 4, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "total", "regex": "Total[\\s\\n]+([\\d ]+,\\d{2}) €", "group": 1, "type": "number"}
            ]
        }
    },
    "nutrimeo": {
        "vendor": {
            "name": "Nutrimeo",
            "currency": "EUR",
            "language": "fr"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Facture N° (\\w+-\\d+)", "group": 1},
                {"name": "invoice_date", "regex": "Date : (\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["désignation", "qté", "p.u. ht", "montant"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Total HT.*?([\\d,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total TTC.*?([\\d,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "buchteiner": {
        "vendor": {
            "name": "Buchsteiner",
            "currency": "EUR",
            "language": "de"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Rechnung\\s+Nr\\.\\s+(\\d+)", "group": 1},
                {"name": "invoice_date", "regex": "Datum:\\s+(\\d{2}\\.\\d{2}\\.\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["pos", "artikel", "menge", "preis"],
            "columns": [
                {"name": "position", "index": 0, "type": "string"},
                {"name": "description", "index": 1, "type": "string"},
                {"name": "quantity", "index": 2, "type": "number"},
                {"name": "unit_price", "index": 4, "type": "number"},
                {"name": "total", "index": 5, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Zwischensumme.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Gesamtsumme.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "dsl_global": {
        "vendor": {
            "name": "DSL Global Logistics",
            "currency": "EUR",
            "language": "en"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Invoice Number:\\s*(\\w+)", "group": 1},
                {"name": "invoice_date", "regex": "Invoice Date:\\s*([\\d/]+)", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["description", "quantity", "unit price", "amount"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Subtotal.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "pro_supply": {
        "vendor": {
            "name": "Pro Supply",
            "currency": "EUR",
            "language": "en"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Invoice No\\.?\\s*([A-Z0-9]+)", "group": 1},
                {"name": "invoice_date", "regex": "Date:.*?(\\d{1,2}\\.\\d{1,2}\\.\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["description", "quantity", "price", "total"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Subtotal.*?([\\d,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Invoice total.*?([\\d,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "shaker_store": {
        "vendor": {
            "name": "Shaker Store",
            "currency": "EUR",
        "language": "en"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "(?:Invoice|Számla).*?(\\d{4,})", "group": 1},
                {"name": "invoice_date", "regex": "(\\d{1,2}[\\.\\/\\-]\\d{1,2}[\\.\\/\\-]\\d{4})", "group": 1, "type": "date"},
                {"name": "name", "regex": "(FITNESS WORLD NUTRITION|FWN)", "group": 1, "target": "customer"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["pcs", "description", "price", "total"],
            "columns": [
                {"name": "quantity", "index": 0, "type": "number"},
                {"name": "sku", "index": 1, "type": "string"},
                {"name": "description", "index": 2, "type": "string"},
                {"name": "unit_price", "index": 3, "type": "number"},
                {"name": "total", "index": 4, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Subtotal.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "ostrovit": {
        "vendor": {
            "name": "Ostrovit",
            "currency": "EUR",
            "language": "pl"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "nr (FA/\\d+/\\d{2}/\\d{4}/MAG)", "group": 1},
                {"name": "invoice_date", "regex": "Date of issue: (\\d{2}\\.\\d{2}\\.\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["description", "quantity", "unit price", "gross value"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "total", "regex": "Gross value EUR.*?([\\d ]+,\\d{2})", "group": 1, "type": "number"}
            ]
        }
    },
    "ostrovit2": {
        "vendor": {
            "name": "Ostrovit",
            "currency": "EUR",
            "language": "pl"
        },
        "note": "Alternative Ostrovit format - uses same config as ostrovit"
    },
    "powerbody": {
        "vendor": {
            "name": "Powerbody",
            "currency": "EUR",
            "language": "pl"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Faktura VAT nr\\s+(\\S+)", "group": 1},
                {"name": "invoice_date", "regex": "Data wystawienia:\\s+(\\d{4}-\\d{2}-\\d{2})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["nazwa towaru", "ilosc", "cena netto", "wartosc"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Razem netto.*?([\\d ]+,\\d{2})", "group": 1, "type": "number"},
                {"name": "total", "regex": "Do zapłaty.*?([\\d ]+,\\d{2})", "group": 1, "type": "number"}
            ]
        }
    },
    "prolife": {
        "vendor": {
            "name": "Prolife",
            "currency": "EUR",
            "language": "it"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Fattura\\s+n\\.\\s*(\\d+)", "group": 1},
                {"name": "invoice_date", "regex": "Data:\\s+(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["descrizione", "quantita", "prezzo", "importo"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Totale.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Totale Fattura.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "io_genix": {
        "vendor": {
            "name": "Io Genix",
            "currency": "GBP",
            "language": "en"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Invoice Number:\\s*(\\w+)", "group": 1},
                {"name": "invoice_date", "regex": "Invoice Date:\\s+(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["description", "qty", "unit price", "amount"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Subtotal.*?£([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total.*?£([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "life_pro": {
        "vendor": {
            "name": "Life Pro",
            "currency": "EUR",
            "language": "es"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Factura\\s+(\\w+)", "group": 1},
                {"name": "invoice_date", "regex": "Fecha:\\s+(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["descripción", "cantidad", "precio", "importe"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Base Imponible.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "max_protein": {
        "vendor": {
            "name": "Max Protein",
            "currency": "EUR",
            "language": "es"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Factura\\s+Nº\\s+(\\w+)", "group": 1},
                {"name": "invoice_date", "regex": "Fecha:\\s+(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["descripción", "cantidad", "precio", "total"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Base Imponible.*?([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total Factura.*?([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    },
    "pb_wholesale": {
        "vendor": {
            "name": "PB Wholesale",
            "currency": "GBP",
            "language": "en"
        },
        "header": {
            "fields": [
                {"name": "invoice_number", "regex": "Invoice\\s+#(\\d+)", "group": 1},
                {"name": "invoice_date", "regex": "Date:\\s+(\\d{2}/\\d{2}/\\d{4})", "group": 1, "type": "date"}
            ]
        },
        "table": {
            "strategy": "pdfplumber_table",
            "header_keywords": ["description", "qty", "price", "line total"],
            "columns": [
                {"name": "description", "index": 0, "type": "string"},
                {"name": "quantity", "index": 1, "type": "number"},
                {"name": "unit_price", "index": 2, "type": "number"},
                {"name": "total", "index": 3, "type": "number"}
            ]
        },
        "footer": {
            "fields": [
                {"name": "subtotal", "regex": "Subtotal.*?£([\\d.,]+)", "group": 1, "type": "number"},
                {"name": "total", "regex": "Total.*?£([\\d.,]+)", "group": 1, "type": "number"}
            ]
        }
    }
}

def generate_configs():
    """Generate all config files"""
    config_dir = Path("python/configs")
    config_dir.mkdir(exist_ok=True)
    
    for supplier_name, config in SUPPLIER_CONFIGS.items():
        config_file = config_dir / f"{supplier_name}.json"
        
        # Skip if special handling note exists
        if "note" in config:
            print(f"⚠️  Skipping {supplier_name}: {config['note']}")
            continue
            
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Created {config_file}")

if __name__ == "__main__":
    generate_configs()
    print("\n🎉 Config generation complete!")
