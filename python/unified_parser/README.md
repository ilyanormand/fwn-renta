# Unified Invoice Parser

A configuration-driven invoice parser engine that replaces multiple vendor-specific Python scripts with a single engine + JSON configs.

## Overview

Instead of maintaining 28+ separate parser scripts, this system uses:
- **1 unified engine** (`python/unified_parser/`)
- **28 JSON configuration files** (`python/configs/`)

## Quick Start

### Run the parser
```bash
python/venv/bin/python -m python.unified_parser.main \
  --config python/configs/dynveo.json \
  --pdf "path/to/invoice.pdf" \
  --json
```

### Example output
```json
{
  "vendor": {"name": "DYNVEO", "currency": "EUR"},
  "customer": {"name": "Fitness World Nutrition"},
  "order_items": [
    {
      "reference": "BERB30060",
      "description": "Berbérine pure (Format : 300mg / 60 gélules)",
      "unit_price": "15.17",
      "quantity": "78",
      "total": "1183.26"
    }
  ],
  "totals": {"subtotal": "2778.56", "total": "2778.56"},
  "metadata": {"invoice_date": "26/08/2025"}
}
```

## Architecture

### Core Files
- `engine.py` - Main parsing logic
- `schemas.py` - Configuration structure definitions
- `utils.py` - Number parsing, text cleaning utilities
- `main.py` - CLI entry point

### Pipeline
1. **PDF → Text**: Extract with `pdfplumber`
2. **Header Parsing**: Extract invoice number, date, customer using regex
3. **Table Parsing**: Extract line items using `pdfplumber_table` or `text_regex` strategy
4. **Footer Parsing**: Extract totals, shipping, tax using regex
5. **Validation**: Calculate totals from line items as fallback

## Configuration Format

### Basic Structure
```json
{
  "vendor": {
    "name": "Supplier Name",
    "currency": "EUR",
    "language": "fr"
  },
  "header": {
    "fields": [
      {
        "name": "invoice_number",
        "regex": "Invoice.*?(\\d{4,})",
        "group": 1,
        "type": "string"
      }
    ]
  },
  "table": {
    "strategy": "pdfplumber_table",
    "header_keywords": ["product", "qty", "price"],
    "columns": [
      {"name": "sku", "index": 0, "type": "string"},
      {"name": "quantity", "index": 2, "type": "number"}
    ]
  },
  "footer": {
    "fields": [
      {
        "name": "total",
        "regex": "Total.*?([\\d.,]+)",
        "group": 1,
        "type": "number"
      }
    ]
  }
}
```

### Header Field Options
- `name`: Field name (e.g., `invoice_number`, `invoice_date`)
- `regex`: Pattern to match
- `group`: Capture group index (default: 1)
- `type`: `string`, `date`, or `number`
- `target`: Where to store (`metadata`, `customer`, `vendor`)

### Table Strategies
1. **`pdfplumber_table`** (recommended)
   - Uses pdfplumber's spatial table detection
   - Define `header_keywords` to identify the right table
   - Map columns by `index`

2. **`text_regex`** (for complex layouts)
   - Line-by-line regex matching
   - Use `start_marker` and `end_marker` to delimit table
   - Map columns by `regex_group`

### Column Configuration
- `name`: Standard field name (`sku`, `description`, `quantity`, `unit_price`, `total`)
- `index`: Column index in table (for `pdfplumber_table`)
- `regex_group`: Group number (for `text_regex`)
- `type`: `string` or `number`

## Example Configs

### French Invoice (Dynveo)
```json
{
  "vendor": {"name": "DYNVEO", "currency": "EUR", "language": "fr"},
  "header": {
    "fields": [
      {"name": "invoice_date", "regex": "(\\d{1,2}/\\d{1,2}/\\d{4})", "type": "date"},
      {"name": "name", "regex": "(FITNESS WORLD NUTRITION)", "target": "customer"}
    ]
  },
  "table": {
    "strategy": "pdfplumber_table",
    "header_keywords": ["référence", "produit", "prix unitaire"],
    "columns": [
      {"name": "reference", "index": 0, "type": "string"},
      {"name": "description", "index": 1, "type": "string"},
      {"name": "unit_price", "index": 3, "type": "number"},
      {"name": "quantity", "index": 4, "type": "number"},
      {"name": "total", "index": 5, "type": "number"}
    ]
  }
}
```

### German Invoice (Inlead)
```json
{
  "vendor": {"name": "Inlead Nutrition GmbH & Co.KG", "language": "de"},
  "table": {
    "header_keywords": ["pos", "menge", "art.-nr", "bezeichnung"],
    "columns": [
      {"name": "position", "index": 0},
      {"name": "quantity", "index": 1, "type": "number"},
      {"name": "sku", "index": 2},
      {"name": "description", "index": 3}
    ]
  }
}
```

### English Invoice (Nakosport)
```json
{
  "vendor": {"name": "Nakosport", "language": "en"},
  "table": {
    "header_keywords": ["brand", "product", "price", "quantity"],
    "columns": [
      {"name": "brand", "index": 0},
      {"name": "description", "index": 1},
      {"name": "unit_price", "index": 3, "type": "number"}
    ]
  }
}
```

## Adding a New Supplier

1. Create `python/configs/<supplier>.json`
2. Define vendor metadata
3. Add regex patterns for header fields
4. Configure table parsing (strategy + columns)
5. Add regex patterns for footer/totals
6. Test with sample invoice

**No Python coding required!**

## Migration Status

✅ **Completed:**
- Dynveo
- Inlead Nutrition
- Nakosport

🔄 **Remaining:**
- Addict, Bolero, DSL Global, Essential Supp, Ingredient SuperFood
- Io Genix, LABZ, Life Pro, Liot, Max Protein
- Novoma, Nutrimea, Nutrimeo, Ostrovit, Pb Wholesale
- Powerbody, Pro Supply, Prolife, Rabeko, Shaker Store
- Swanson, Yamamoto, Buchsteiner
- (~23 suppliers)

## Benefits

1. **Easier maintenance**: Edit JSON instead of Python
2. **No code duplication**: Common logic in one place
3. **Faster onboarding**: New suppliers = new config file
4. **Better testing**: Configs are data, easier to validate
5. **More accurate**: Unified parser tested to be more accurate than legacy scripts
