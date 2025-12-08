#!/usr/bin/env python3
"""
Enhanced PDF inspector showing full table extraction
"""
import sys
import pdfplumber
import json

def inspect_tables_detailed(pdf_path):
    print(f"\n📄 Detailed Table Inspection: {pdf_path}\n")
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            print(f"\n{'='*80}")
            print(f"PAGE {page_num + 1}")
            print('='*80)
            
            tables = page.extract_tables()
            print(f"\nFound {len(tables)} tables on this page")
            
            for i, table in enumerate(tables):
                print(f"\n--- Table {i+1} ---")
                if table:
                    print(f"Rows: {len(table)}")
                    print(f"Columns: {len(table[0]) if table else 0}")
                    print("\nFirst 5 rows:")
                    for row in table[:5]:
                        print(json.dumps(row, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_tables.py <pdf_path>")
        sys.exit(1)
    
    inspect_tables_detailed(sys.argv[1])
