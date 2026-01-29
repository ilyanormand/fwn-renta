import os
import json
from collections import Counter
from unified_parser.engine import UnifiedInvoiceParser
from unified_parser.schemas import ParserConfig

def get_config():
    # Load config from io_genix.json
    with open('python/configs/io_genix.json', 'r') as f:
        config_data = json.load(f)
    
    return ParserConfig.from_dict(config_data)

def test_file(filename, expected_total=None):
    filepath = f"python/test_invoices/Io Genix/{filename}"
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return

    config = get_config()
    parser = UnifiedInvoiceParser(filepath, config)
    data = parser.extract()
    
    items = data.get('order_items', [])
    totals = data.get('totals', {})
    
    calculated_total = 0.0
    for item in items:
        if item.get('total'):
            calculated_total += float(item['total'])
            
    print(f"File: {filename}")
    print(f"Items: {len(items)}")
    print(f"Calculated Total from Items: {calculated_total:.2f}")
    print(f"Extracted Total: {totals.get('total')}")
    if expected_total:
        print(f"Expected: {expected_total}")
        diff = abs(calculated_total - expected_total)
        if diff < 1.0:
            print("✅ MATCH")
        else:
            print(f"❌ MISMATCH (Diff: {diff:.2f})")
            
            # Sort items by total descending
            items_sorted = sorted(items, key=lambda x: float(x.get('total', 0)), reverse=True)
            print("Top 5 items by total:")
            for item in items_sorted[:5]:
                print(f"  {item.get('sku')} | Qty: {item.get('quantity')} | Price: {item.get('unit_price')} | Total: {item.get('total')}")

    print("-" * 40)

def main():
    files = [
        ("FRA 253427 SARL FITNESS 15.10.pdf", 28815.14),
        ("FRA 253683 SARL FITNESS WORLD 03.11.pdf", 18664.24),
        ("FRA 26164 SARL FITNESS 19.01.pdf", 22164.64),
    ]
    
    for f, expected in files:
        test_file(f, expected)

if __name__ == "__main__":
    main()
