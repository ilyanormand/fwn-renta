import os
import sys
import json
import glob
import importlib.util
import subprocess
from pathlib import Path
from typing import List, Dict, Any
from validator_logic import InvoiceValidator

# Configuration
TEST_INVOICES_DIR = Path("python/test_invoices")
PARSERS_DIR = Path("python")
EXPECTED_TOTALS_FILE = TEST_INVOICES_DIR / "expected_totals.json"

def find_parser_for_vendor(vendor_slug: str) -> Path:
    """
    Find the parser script for a given vendor directory.
    Tries:
    1. invoice_extractor_{vendor_slug}.py
    2. invoice_extractor-{vendor_slug}.py
    """
    # Normalize slug (replace spaces with underscores or hyphens)
    normalized_slug = vendor_slug.replace(" ", "_").lower()
    
    # Try underscore
    p1 = PARSERS_DIR / f"invoice_extractor_{normalized_slug}.py"
    if p1.exists():
        return p1
        
    # Try hyphen
    p2 = PARSERS_DIR / f"invoice_extractor-{normalized_slug}.py"
    if p2.exists():
        return p2
        
    # Try original folder name if different
    p3 = PARSERS_DIR / f"invoice_extractor_{vendor_slug}.py"
    if p3.exists():
        return p3
        
    # Explicit mappings for known discrepancies
    mappings = {
        "buchsteiner": "invoice_extractor_buchteiner.py",
        "naskorsports": "invoice_extractor-nakosport.py",
        "pb_wholesale": "invoice_extractor-pb_wholesale.py",
        "pb wholesale": "invoice_extractor-pb_wholesale.py",
        "powerbody": "invoice_extractor_powerbody.py",
        "pro_supply": "invoice_extractor-pro_supply.py",
        "pro supply": "invoice_extractor-pro_supply.py",
        "shaker_store": "invoice_extractor-shaker_store.py",
        "shaker store": "invoice_extractor-shaker_store.py",
        "life_pro": "invoice_extractor-life_pro.py",
        "life pro": "invoice_extractor-life_pro.py",
        "max_protein": "invoice_extractor-max_protein.py",
        "max protein": "invoice_extractor-max_protein.py",
        "io_genix": "invoice_extractor-io_genix.py",
        "io genix": "invoice_extractor-io_genix.py",
        "dsl_global": "invoice_extractor_dsl_global.py",
        "dsl global": "invoice_extractor_dsl_global.py",
    }
    
    if normalized_slug in mappings:
        p_map = PARSERS_DIR / mappings[normalized_slug]
        if p_map.exists():
            return p_map
            
    return None

def run_parser(parser_path: Path, pdf_path: Path) -> Dict[str, Any]:
    """
    Run the parser script as a subprocess and capture JSON output.
    """
    try:
        # Use the current python interpreter (from venv if active)
        cmd = [sys.executable, str(parser_path), str(pdf_path), "--json"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        
        if result.returncode != 0:
            return {"error": f"Parser crashed with code {result.returncode}", "stderr": result.stderr}
            
        # Try to find JSON in stdout (in case of debug prints)
        output = result.stdout.strip()
        
        # Simple heuristic: find the last line that looks like JSON
        lines = output.split('\n')
        json_line = ""
        for line in reversed(lines):
            if line.strip().startswith('{') and line.strip().endswith('}'):
                json_line = line.strip()
                break
        
        if not json_line:
            # Try parsing the whole output
            json_line = output

        try:
            return json.loads(json_line)
        except json.JSONDecodeError:
            return {"error": "Invalid JSON output", "raw_output": output}
            
    except Exception as e:
        return {"error": f"Execution failed: {str(e)}"}

def main():
    print("🚀 Starting Batch Validation...")
    
    if not TEST_INVOICES_DIR.exists():
        print(f"❌ Test directory not found: {TEST_INVOICES_DIR}")
        print("   Please create it and add vendor subdirectories with PDF files.")
        return

    vendor_dirs = [d for d in TEST_INVOICES_DIR.iterdir() if d.is_dir()]
    
    if not vendor_dirs:
        print(f"⚠️  No vendor directories found in {TEST_INVOICES_DIR}")
        return

    results = {
        "total": 0,
        "passed": 0,
        "failed": 0,
        "warnings": 0
    }

    # Load expected totals
    expected_totals = {}
    if EXPECTED_TOTALS_FILE.exists():
        try:
            with open(EXPECTED_TOTALS_FILE, 'r') as f:
                expected_totals = json.load(f)
            print(f"ℹ️  Loaded {len(expected_totals)} expected totals from {EXPECTED_TOTALS_FILE.name}")
        except Exception as e:
            print(f"⚠️  Failed to load expected totals: {e}")

    for vendor_dir in vendor_dirs:
        vendor_name = vendor_dir.name
        print(f"\n📂 Processing vendor: {vendor_name}")
        
        parser_path = find_parser_for_vendor(vendor_name)
        if not parser_path:
            print(f"   ❌ No parser found for {vendor_name} (checked invoice_extractor_{vendor_name}.py)")
            continue
            
        print(f"   🔧 Using parser: {parser_path.name}")
        
        pdf_files = list(vendor_dir.glob("*.pdf")) + list(vendor_dir.glob("*.PDF")) + list(vendor_dir.glob("*.Pdf"))
        if not pdf_files:
            print("   ⚠️  No PDF files found")
            continue
            
        for pdf_file in pdf_files:
            print(f"   📄 Testing {pdf_file.name}...", end=" ")
            results["total"] += 1
            
            # Run Parser
            data = run_parser(parser_path, pdf_file)
            
            if "error" in data:
                print("❌ FAILED (Execution)")
                print(f"      Error: {data['error']}")
                results["failed"] += 1
                continue
                
            # Validate Data
            validator = InvoiceValidator(data)
            validation_res = validator.validate()
            
            # Check against expected total if available
            if pdf_file.name in expected_totals:
                expected_val = expected_totals[pdf_file.name]
                try:
                    parser_total = float(str(data.get('totals', {}).get('total', '0')).replace(',', '.'))
                    if abs(parser_total - expected_val) > 0.05:
                        validation_res["valid"] = False
                        validation_res["errors"].append(f"Total mismatch: Parser found {parser_total}, expected {expected_val}")
                except (ValueError, TypeError):
                    validation_res["valid"] = False
                    validation_res["errors"].append(f"Could not parse total from parser output for comparison: {data.get('totals', {}).get('total')}")

            if not validation_res["valid"]:
                print("❌ FAILED (Validation)")
                for err in validation_res["errors"]:
                    print(f"      - {err}")
                results["failed"] += 1
            elif validation_res["warnings"]:
                print("⚠️  PASSED with WARNINGS")
                for warn in validation_res["warnings"]:
                    print(f"      - {warn}")
                results["passed"] += 1
                results["warnings"] += 1
            else:
                print("✅ PASSED")
                results["passed"] += 1

    print("\n" + "="*30)
    print("📊 Validation Summary")
    print("="*30)
    print(f"Total Invoices: {results['total']}")
    print(f"Passed:         {results['passed']}")
    print(f"Failed:         {results['failed']}")
    print(f"Warnings:       {results['warnings']}")
    print("="*30)

if __name__ == "__main__":
    main()
