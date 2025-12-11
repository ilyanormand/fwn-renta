#!/usr/bin/env python3
"""
Enhanced PDF inspector showing full table extraction
"""
import sys
import os
import re
from pathlib import Path
import pdfplumber
import json

def inspect_tables_detailed(pdf_path, output_file=None):
    """
    Inspect tables in PDF and output to stdout or file.
    
    Args:
        pdf_path: Path to PDF file
        output_file: Optional path to output file. If None, outputs to stdout.
    """
    output_lines = []
    
    def output(text):
        if output_file:
            output_lines.append(text)
        else:
            print(text)
    
    output(f"\n📄 Detailed Table Inspection: {pdf_path}\n")
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            output(f"\n{'='*80}")
            output(f"PAGE {page_num + 1}")
            output('='*80)
            
            tables = page.extract_tables()
            output(f"\nFound {len(tables)} tables on this page")
            
            for i, table in enumerate(tables):
                output(f"\n--- Table {i+1} ---")
                if table:
                    output(f"Rows: {len(table)}")
                    output(f"Columns: {len(table[0]) if table else 0}")
                    output("\nFirst 5 rows:")
                    for row in table[:5]:
                        output(json.dumps(row, ensure_ascii=False))
    
    # Write to file if specified
    if output_file:
        output_path = Path(output_file)
        # Create parent directory if it doesn't exist
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(output_lines))
        print(f"✅ Debug output saved to: {output_path}", file=sys.stderr)

def determine_supplier_from_path(pdf_path):
    """Determine supplier name from PDF path"""
    pdf_path_lower = str(pdf_path).lower()
    
    # Map of keywords to supplier folder names
    supplier_map = {
        "io genix": "io_genix",
        "iogenix": "io_genix",
        "addict": "addict",
        "dsl": "dsl_global",
        "labz": "labz",
        "liot": "liot",
        "max protein": "max_protein",
        "nutrimeo": "nutrimeo",
        "ostrovit": "ostrovit",
        "powerbody": "powerbody",
        "prolife": "prolife",
        "shaker": "shaker_store",
        "yamamoto": "yamamoto",
    }
    
    for keyword, supplier in supplier_map.items():
        if keyword in pdf_path_lower:
            return supplier
    
    return "unknown"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_tables.py <pdf_path>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    # Auto-generate output file path in logs/{supplier}/ directory
    pdf_path_obj = Path(pdf_path)
    pdf_name = pdf_path_obj.stem
    
    # Extract invoice number (e.g., "FRA 253427" -> "253427")
    invoice_match = re.search(r'(\d{6,})', pdf_name)
    invoice_num = invoice_match.group(1) if invoice_match else "unknown"
    
    # Determine supplier from PDF path
    supplier = determine_supplier_from_path(pdf_path)
    
    # Generate output path: logs/{supplier}/{supplier}_{invoice_num}_debug.txt
    output_file = Path("logs") / supplier / f"{supplier}_{invoice_num}_debug.txt"
    
    inspect_tables_detailed(pdf_path, output_file)
