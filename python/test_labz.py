import json
from unified_parser.engine import UnifiedInvoiceParser
from unified_parser.schemas import ParserConfig

def get_config():
    with open('python/configs/labz.json', 'r') as f:
        config_data = json.load(f)
    return ParserConfig.from_dict(config_data)

def test_file(filename, expected_total=None):
    filepath = f"python/test_invoices/LABZ/{filename}"
    
    config = get_config()
    parser = UnifiedInvoiceParser(filepath, config)
    data = parser.extract()
    
    items = data.get('order_items', [])
    totals = data.get('totals', {})
    
    calculated_total = 0.0
    for item in items:
        if item.get('total'):
            calculated_total += float(item['total'])
    
    shipping = float(totals.get('shipping_fee', 0))
    total_with_shipping = calculated_total + shipping
            
    print(f"File: {filename}")
    print(f"Items: {len(items)}")
    print(f"Items Total: {calculated_total:.2f}")
    print(f"Shipping: {shipping:.2f}")
    print(f"Items + Shipping: {total_with_shipping:.2f}")
    print(f"Extracted Total: {totals.get('total')}")
    if expected_total:
        print(f"Expected: {expected_total}")
        diff = abs(total_with_shipping - expected_total)
        if diff < 1.0:
            print("✅ MATCH")
        else:
            print(f"❌ MISMATCH (Diff: {diff:.2f})")
    print("-" * 60)

def main():
    files = [
        ("facture_59224 (1).pdf", 3261.70),
        ("facture_60224 (1).pdf", 2457.69),
        ("facture_61323 (1).pdf", 1796.53),
        ("facture_LABZ62248 (1).pdf", 2204.48),
        ("facture_LABZ65216 (1).pdf", 2247.98),
    ]
    
    for f, expected in files:
        try:
            test_file(f, expected)
        except Exception as e:
            print(f"Error processing {f}: {e}")
            print("-" * 60)

if __name__ == "__main__":
    main()
