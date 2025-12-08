#!/usr/bin/env python3
"""
Quick fixer for problematic configs - converts to appropriate strategy based on PDF inspection
"""
import json
import subprocess
import sys
from pathlib import Path

# Suppliers that need fixing based on initial tests
FIX_MAP = {
    "nutrimeo": "pdfplumber",  # May just need different header keywords
    "dsl_global": "pdfplumber",
    "ostrovit": "text_regex",  # Ostrovit has complex layout
    "powerbody": "text_regex",  # Polish supplier, likely complex
    "prolife": "text_regex",  # Italian, likely complex
    "io_genix": "pdfplumber",
    "max_protein": "pdfplumber"
}

def test_config(config_name):
    """Test a config and return number of items extracted"""
    # Find test PDF
    test_dirs = Path("python/test_invoices").glob("*")
    pdf_path = None
    
    for test_dir in test_dirs:
        if not test_dir.is_dir():
            continue
        if config_name.lower().replace("_", "") in test_dir.name.lower().replace(" ", "").replace("_", ""):
            pdfs = list(test_dir.glob("*.pdf"))
            if pdfs:
                pdf_path = pdfs[0]
                break
    
    if not pdf_path:
        return -1, "No PDF found"
    
    # Run parser
    cmd = [
        "python/venv/bin/python", 
        "-m", "python.unified_parser.main",
        "--config", f"python/configs/{config_name}.json",
        "--pdf", str(pdf_path),
        "--json"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            items = len(data.get("order_items", []))
            total = data.get("totals", {}).get("total", "N/A")
            return items, total
        else:
            return 0, f"Error: {result.stderr[:100]}"
    except Exception as e:
        return 0, str(e)[:100]

def main():
    print("\n🔧 Testing all configs...\n")
    print(f"{'Config':<20} {'Items':<8} {'Total':<15} {'Status'}")
    print("=" * 70)
    
    results = {"ok": [], "need_fix": []}
    
    for config_file in sorted(Path("python/configs").glob("*.json")):
        config_name = config_file.stem
        
        if config_name == "novoma":  # Skip XML-only
            continue
            
        items, total = test_config(config_name)
        
        if items > 0:
            status = "✅ OK"
            results["ok"].append(config_name)
        elif items == 0:
            status = "❌ NEED FIX"
            results["need_fix"].append(config_name)
        else:
            status = "⏭️  SKIP"
            continue
        
        print(f"{config_name:<20} {str(items):<8} {str(total):<15} {status}")
    
    print("=" * 70)
    print(f"\n📊 Summary:")
    print(f"  ✅ Working: {len(results['ok'])}")
    print(f"  ❌ Need Fix: {len(results['need_fix'])}")
    
    if results["need_fix"]:
        print(f"\n🔧 Configs to fix: {', '.join(results['need_fix'])}")
    
    return results

if __name__ == "__main__":
    main()
