#!/usr/bin/env python3
"""
Bulk config fixer - inspects PDFs and converts configs to text_regex where needed
"""
import json
import subprocess
from pathlib import Path

# Configs that showed 0 items or N/A total
PROBLEM_CONFIGS = [
    "dsl_global", "ingredient_superfood", "io_genix", "labz", 
    "liot", "max_protein", "nutrimeo", "ostrovit", 
    "powerbody", "prolife", "shaker_store", "yamamoto"
]

def inspect_pdf_simple(pdf_path):
    """Quick PDF inspection to see if tables are detected"""
    cmd = ["python/venv/bin/python", "python/inspect_tables.py", str(pdf_path)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
    
    # Count how many tables were found
    table_count = result.stdout.count("Found") - result.stdout.count("Found 0")
    has_tables = "Rows:" in result.stdout and "Columns:" in result.stdout
    
    return has_tables, table_count

def find_test_pdf(config_name):
    """Find test PDF for a config"""
    test_dirs = Path("python/test_invoices").glob("*")
    
    for test_dir in test_dirs:
        if not test_dir.is_dir():
            continue
        dir_name_clean = test_dir.name.lower().replace(" ", "").replace("_", "")
        config_clean = config_name.lower().replace("_", "")
        
        if config_clean in dir_name_clean or dir_name_clean in config_clean:
            pdfs = list(test_dir.glob("*.pdf"))
            if pdfs:
                return pdfs[0]
    return None

def main():
    print("\n🔍 Analyzing problematic configs...\n")
    
    recommendations = {}
    
    for config_name in PROBLEM_CONFIGS:
        pdf_path = find_test_pdf(config_name)
        if not pdf_path:
            print(f"⏭️  {config_name}: No test PDF found")
            continue
        
        try:
            has_tables, table_count = inspect_pdf_simple(pdf_path)
            
            if has_tables and table_count > 0:
                strategy = "pdfplumber (adjust keywords/indices)"
                action = "TUNE"
            else:
                strategy = "text_regex (no tables detected)"
                action = "CONVERT"
            
            recommendations[config_name] = {
                "pdf": pdf_path.name,
                "strategy": strategy,
                "action": action
            }
            
            print(f"{'✏️ ' if action == 'CONVERT' else '🔧'} {config_name:<20} → {strategy}")
            
        except Exception as e:
            print(f"❌ {config_name}: Error - {str(e)[:50]}")
    
    print(f"\n📊 Analysis complete: {len(recommendations)} configs analyzed")
    print(f"   Convert to text_regex: {sum(1 for r in recommendations.values() if r['action'] == 'CONVERT')}")
    print(f"   Tune pdfplumber: {sum(1 for r in recommendations.values() if r['action'] == 'TUNE')}")
    
    return recommendations

if __name__ == "__main__":
    main()
