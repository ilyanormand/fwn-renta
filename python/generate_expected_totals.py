import os
import json
import sys
from pathlib import Path
from validate_parsers import find_parser_for_vendor, run_parser, TEST_INVOICES_DIR

def generate_totals():
    print("🚀 Generating Expected Totals Baseline...")
    
    if not TEST_INVOICES_DIR.exists():
        print(f"❌ Test directory not found: {TEST_INVOICES_DIR}")
        return

    expected_totals = {}
    
    vendor_dirs = [d for d in TEST_INVOICES_DIR.iterdir() if d.is_dir()]
    
    for vendor_dir in vendor_dirs:
        vendor_name = vendor_dir.name
        print(f"\n📂 Processing vendor: {vendor_name}")
        
        parser_path = find_parser_for_vendor(vendor_name)
        if not parser_path:
            print(f"   ❌ No parser found for {vendor_name}")
            continue
            
        pdf_files = list(vendor_dir.glob("*.pdf")) + list(vendor_dir.glob("*.PDF")) + list(vendor_dir.glob("*.Pdf"))
        
        for pdf_file in pdf_files:
            print(f"   📄 Extracting {pdf_file.name}...", end=" ")
            
            # Run Parser
            data = run_parser(parser_path, pdf_file)
            
            if "error" in data:
                print("❌ FAILED")
                continue
                
            # Extract total
            try:
                total_str = data.get('totals', {}).get('total')
                if total_str:
                    # Normalize to float for storage
                    total_val = float(str(total_str).replace(',', '.'))
                    expected_totals[pdf_file.name] = total_val
                    print(f"✅ {total_val}")
                else:
                    print("⚠️  No total found")
            except (ValueError, TypeError):
                print(f"⚠️  Invalid total format: {data.get('totals', {}).get('total')}")

    # Save to JSON
    output_path = TEST_INVOICES_DIR / "expected_totals.json"
    with open(output_path, "w") as f:
        json.dump(expected_totals, f, indent=2, sort_keys=True)
        
    print(f"\n💾 Saved {len(expected_totals)} expected totals to {output_path}")
    print("⚠️  IMPORTANT: Please review this file manually to ensure the totals are correct!")

if __name__ == "__main__":
    generate_totals()
