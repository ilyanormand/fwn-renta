#!/usr/bin/env python3
"""
Test all configs against their sample invoices.
"""

import json
import os
import subprocess
from pathlib import Path

def test_config(config_name, pdf_path):
    """Test a single config against a PDF"""
    config_path = f"python/configs/{config_name}.json"
    
    if not os.path.exists(config_path):
        return{"status": "skip", "reason": "No config file"}
    
    if not os.path.exists(pdf_path):
        return {"status": "skip", "reason": "No PDF file"}
    
    cmd = [
        "python/venv/bin/python",
        "-m", "python.unified_parser.main",
        "--config", config_path,
        "--pdf", pdf_path,
        "--json"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if "error" in data:
                return {"status": "error", "message": data["error"]}
            else:
                num_items = len(data.get("order_items", []))
                total = data.get("totals", {}).get("total", "N/A")
                return {"status": "success", "items": num_items, "total": total}
        else:
            return {"status": "error", "message": result.stderr[:200]}
    except subprocess.TimeoutExpired:
        return {"status": "timeout"}
    except Exception as e:
        return {"status": "error", "message": str(e)[:200]}

def main():
    # Suppliers with existing parsers and test invoices
    test_cases = [
        ("dynveo", "python/test_invoices/Dynveo/FA2025-083518 (1).pdf"),
        ("inlead", "python/test_invoices/Inlead"),
        ("nakosport", "python/test_invoices/NASKORSPORTS"),
        ("nutrimea", "python/test_invoices/Nutrimea"),
        ("nutrimeo", "python/test_invoices/Nutrimeo"),
        ("buchteiner", "python/test_invoices/buchsteiner"),
        ("dsl_global", "python/test_invoices/DSL Global"),
        ("pro_supply", "python/test_invoices/Pro Supply"),
        ("shaker_store", "python/test_invoices/Shaker Store"),
        ("ostrovit", "python/test_invoices/Ostrovit"),
        ("powerbody", "python/test_invoices/Powerbody"),
        ("prolife", "python/test_invoices/Prolife"),
        ("io_genix", "python/test_invoices/Io Genix"),
        ("life_pro", "python/test_invoices/Life pro"),
        ("max_protein", "python/test_invoices/Max protein"),
        ("pb_wholesale", "python/test_invoices/Pb wholesale"),
    ]
    
    print("\\n🧪 Testing Unified Parser Configs\\n")
    print(f"{'Supplier':<20} {'Status':<10} {'Items':<8} {'Total':<15} {'Message'}")
    print("=" * 80)
    
    results = {"success": 0, "error": 0, "skip": 0}
    
    for config_name, pdf_dir in test_cases:
        # Find first PDF in directory
        pdf_path = pdf_dir
        if os.path.isdir(pdf_dir):
            pdfs = [f for f in os.listdir(pdf_dir) if f.lower().endswith('.pdf')]
            if pdfs:
                pdf_path = os.path.join(pdf_dir, pdfs[0])
            else:
                pdf_path = ""
        
        result = test_config(config_name, pdf_path)
        status = result["status"]
        results[status if status in results else "error"] += 1
        
        items = result.get("items", "-")
        total = result.get("total", "-")
        message = result.get("message", result.get("reason", ""))
        
        status_icon = {"success": "✅", "error": "❌", "skip": "⏭️ ", "timeout": "⏱️ "}.get(status, "❓")
        
        print(f"{config_name:<20} {status_icon} {status:<8} {str(items):<8} {str(total):<15} {message[:30]}")
    
    print("=" * 80)
    print(f"\\n📊 Summary: {results['success']} passed, {results['error']} failed, {results['skip']} skipped\\n")

if __name__ == "__main__":
    main()
