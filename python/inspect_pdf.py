#!/usr/bin/env python3
"""
Quick inspector for PDF invoices to help create configs.
"""
import sys
import pdfplumber

def inspect_pdf(pdf_path):
    print(f"\n📄 Inspecting: {pdf_path}\n")
    
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(page.extract_text(layout=True) or "" for page in pdf.pages)
        
        print("=" * 80)
        print("FULL TEXT:")
        print("=" * 80)
        print(text)
        print("\n" + "=" * 80)
        
        # Extract tables
        print("\n" + "=" * 80)
        print("TABLES DETECTED:")
        print("=" * 80)
        # The original code only extracted tables from the first page.
        # The instruction only modified the text extraction part.
        # To keep the table extraction consistent with the original (first page only),
        # I will re-introduce the `page = pdf.pages[0]` line before table extraction.
        # If the intention was to extract tables from all pages, the instruction should have specified that.
        # Given the instruction only touched the text part and the original table extraction was page[0],
        # I'll assume tables are still only from the first page.
        page = pdf.pages[0] # Re-initialize page for table extraction as per original logic
        tables = page.extract_tables()
        for i, table in enumerate(tables):
            print(f"\nTable {i+1}:")
            if table and len(table) > 0:
                # Show first 3 rows
                for row in table[:3]:
                    print(row)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_pdf.py <pdf_path>")
        sys.exit(1)
    
    inspect_pdf(sys.argv[1])
