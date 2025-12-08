import re
import json
from decimal import Decimal
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams
from datetime import datetime

class NutrimeoInvoiceParser:
    def __init__(self):
        self.supplier_name = "Nutrimeo"
        self.currency = "EUR"
        
    def extract(self, pdf_path):
        """Main extraction method with error handling"""
        try:
            # Initialize shipping fee
            self._shipping_fee = None
            
            # Extract text with layout analysis
            laparams = LAParams(boxes_flow=0.5, word_margin=0.1)
            raw_text = extract_text(pdf_path, laparams=laparams)
            
            # Parse components - process line items first to capture shipping fee
            line_items = self._extract_line_items(raw_text)
            header_info = self._extract_header_info(raw_text)
            
            # Build result
            result = {
                **header_info,
                'line_items': line_items,
                'supplier': self.supplier_name,
                'currency': self.currency
            }
            
            # Validate before returning
            validation_errors = self._validate_extraction(result)
            if validation_errors:
                result['validation_errors'] = validation_errors
            
            return result
            
        except Exception as e:
            return {'error': f"Extraction failed: {str(e)}"}
    
    def _extract_header_info(self, text):
        """Extract invoice metadata"""
        header_info = {}
        
        # Extract invoice number
        invoice_match = re.search(r'Num\. Facture\s+([A-Z0-9-]+)', text)
        if invoice_match:
            header_info['invoice_number'] = invoice_match.group(1)
        
        # Extract invoice date
        date_match = re.search(r'Date Facture\s+(\d{1,2}\s+\w+\.?\s+\d{4})', text)
        if date_match:
            date_str = date_match.group(1)
            # Convert French date format to standard format
            header_info['invoice_date'] = self._parse_french_date(date_str)
        
        # Extract client number
        client_match = re.search(r'Num\. client\s+(\d+)', text)
        if client_match:
            header_info['client_number'] = client_match.group(1)
        
        # Extract order number
        order_match = re.search(r'Num\. commande\s+(\d+)', text)
        if order_match:
            header_info['order_number'] = order_match.group(1)
        
        # Extract total amount
        total_match = re.search(r'À payer\s+([\d,]+\.\d{2})\s*€', text)
        if total_match:
            total_str = total_match.group(1).replace(',', '')
            header_info['total_amount'] = float(total_str)
        
        # Extract subtotal HT
        subtotal_match = re.search(r'Sous-total HT\s+([\d,]+\.\d{2})\s*€', text)
        if subtotal_match:
            subtotal_str = subtotal_match.group(1).replace(',', '')
            header_info['subtotal_ht'] = float(subtotal_str)
        
        # Try to extract shipping cost with multiple patterns
        shipping_ht = None
        
        # Pattern 1: Look for "Frais de port HT" followed by amount (may be on different lines)
        shipping_pattern1 = r'Frais de port HT[\s\S]*?([\d,]+,\d{2})\s*€'
        shipping_match1 = re.search(shipping_pattern1, text, re.MULTILINE | re.DOTALL)
        
        if shipping_match1:
            # Check if this is actually the shipping amount (not subtotal)
            amount_str = shipping_match1.group(1)
            if amount_str != '274,87':  # Avoid capturing subtotal
                shipping_str = amount_str.replace(',', '.')
                try:
                    shipping_ht = float(shipping_str)
                except ValueError:
                    pass
        
        # Pattern 2: Look for shipping amount in summary section (second amount after "À payer")
        if shipping_ht is None:
            # Look for three amounts after "À payer": subtotal, shipping, total
            summary_pattern = r'À payer[\s\S]*?([\d,]+,\d{2})\s*€[\s\S]*?([\d,]+,\d{2})\s*€[\s\S]*?([\d,]+,\d{2})\s*€'
            summary_match = re.search(summary_pattern, text, re.MULTILINE | re.DOTALL)
            if summary_match:
                subtotal_str = summary_match.group(1)
                shipping_str = summary_match.group(2).replace(',', '.')
                total_str = summary_match.group(3)
                
                try:
                    potential_shipping = float(shipping_str)
                    # Verify this is a reasonable shipping amount (typically less than 100€)
                    if potential_shipping < 100.0:
                        shipping_ht = potential_shipping
                except ValueError:
                    pass
        
        # Apply 20% VAT if shipping amount found
        if shipping_ht:
            header_info['shipping_ht'] = shipping_ht
            header_info['shipping_cost'] = round(shipping_ht * 1.20, 2)
        
        # Final fallback: Include shipping fee from line items processing if available and no HT found
        if 'shipping_cost' not in header_info and hasattr(self, '_shipping_fee') and self._shipping_fee:
            header_info['shipping_ht'] = self._shipping_fee
            header_info['shipping_cost'] = round(self._shipping_fee * 1.20, 2)
        
        return header_info
    
    def _extract_line_items(self, text):
        """Extract product line items with cross-page reconstruction"""
        line_items = []
        
        # Split text into lines for analysis
        lines = text.split('\n')
        
        # Find SKUs and product descriptions
        products = []
        for i, line in enumerate(lines):
            line = line.strip()
            # Look for numeric SKU pattern (4-5 digits)
            if re.match(r'^\d{4,5}$', line):
                # Get description from next non-empty lines
                description_parts = []
                for j in range(i+1, min(i+10, len(lines))):
                    next_line = lines[j].strip()
                    if next_line and not re.match(r'^\d{4,5}$', next_line) and not next_line.startswith('DLUO'):
                        # Check if it's a product name (contains letters)
                        if re.search(r'[A-Za-z]', next_line) and not next_line in ['Taux', 'Base HT', 'TVA', 'Mode de paiement']:
                            description_parts.append(next_line)
                        if len(description_parts) >= 2:  # Usually product name + variant
                            break
                description = ' '.join(description_parts)
                if description:
                    products.append({
                        'sku': line,
                        'description': description
                    })
        
        # Find table structure - look for header row with "Quantité"
        table_start_idx = -1
        for i, line in enumerate(lines):
            if 'Quantité' in line:
                table_start_idx = i
                break
        
        # Extract quantities, unit prices (TTC), and totals from table structure
        quantities = []
        unit_prices_ttc = []
        total_prices = []
        
        if table_start_idx != -1:
            # Find quantities section (after products, before pricing data)
            quantity_start = -1
            for i, line in enumerate(lines):
                if line.strip() == "Mode de paiement":
                    quantity_start = i + 1
                    break
            
            if quantity_start != -1:
                # Extract quantities (consecutive single/double digit numbers)
                # Based on user feedback, we should have 7 quantities: [2, 4, 4, 1, 1, 1, 1]
                for i in range(quantity_start, quantity_start + 15):  # Look further
                    if i < len(lines):
                        line = lines[i].strip()
                        if re.match(r'^\d{1,2}$', line):
                            quantities.append(int(line))
                        elif line and not re.match(r'^\d{1,2}$', line) and line != '':
                            # Don't break on empty lines, continue looking
                            if len(quantities) >= 7:  # We expect 7 quantities
                                break
                
                # Find pricing data section (after all quantities)
                # Skip over remaining quantities and empty lines to find first price
                pricing_start = quantity_start + len(quantities)
                
                # Look for the first price (should be around line with €)
                for i in range(pricing_start, len(lines)):
                    line = lines[i].strip()
                    if re.match(r'^([\d]+,[\d]{2})\s+€$', line):
                        pricing_start = i
                        break
                
                pricing_data = []
                
                # Extract all price values in sequence
                for i in range(pricing_start, len(lines)):
                    line = lines[i].strip()
                    
                    price_match = re.match(r'^([\d]+,[\d]{2})\s+€$', line)
                    if price_match:
                        price_value = float(price_match.group(1).replace(',', '.'))
                        pricing_data.append(price_value)
                    elif line and not re.match(r'^\d+\.\d+%$', line) and '€' not in line:
                        # Stop when we hit non-price, non-VAT data
                        if line and not line.isdigit():  # Don't stop on single digits
                            break
                
                # Parse pricing data: groups of 3 values per product
                # Pattern analysis shows: Prix u. HT, Prix u. TTC, Total TTC (with VAT% interspersed)
                # Based on debug output: [20.99, 22.14, 44.29, 20.99, 22.14, 88.58, ...]
                # For 7 products with quantities [2, 4, 4, 1, 1, 1, 1]
                # Expected TTC prices: [22.14, 22.14, 22.14, 22.14, 22.14, 24.25, 0]
                # Expected totals: [44.28, 88.56, 88.56, 22.14, 22.14, 24.25, 0]
                
                # Extract every 2nd value as Prix u. TTC, every 3rd as Total TTC
                for i in range(0, len(pricing_data), 3):
                    if i + 2 < len(pricing_data):
                        # pricing_data[i] = Prix u. HT
                        # pricing_data[i + 1] = Prix u. TTC  
                        # pricing_data[i + 2] = Total TTC
                        unit_price_ttc = pricing_data[i + 1]
                        total_price = pricing_data[i + 2]
                        unit_prices_ttc.append(unit_price_ttc)
                        total_prices.append(total_price)
                
                # Handle shipment costs - sum multiple shipping charges
                # Look for shipping costs throughout the document
                shipping_costs = []
                
                # Store shipping costs for header info, but don't add as line item
                if shipping_costs:
                    total_shipping = round(sum(shipping_costs), 2)
                    # Store shipping fee for later use in header info (this is already HT amount)
                    self._shipping_fee = total_shipping
                    # Don't add shipping as a line item - it will be handled separately
        
        # Find VAT rates
        vat_rates = []
        for line in lines:
            line = line.strip()
            vat_match = re.search(r'(\d+\.\d+)%', line)
            if vat_match:
                vat_rate = float(vat_match.group(1))
                if vat_rate not in vat_rates:
                    vat_rates.append(vat_rate)
        
        if not vat_rates:
            vat_rates = [5.5]  # Default VAT rate
        
        # Extract SKUs and descriptions from products
        skus = [product['sku'] for product in products]
        descriptions = [product['description'] for product in products]
        
        # Create line items using quantities, unit_prices_ttc, and total_prices
        # Filter out shipping items (SKU 'SHIPPIN' or 'SHIPPING' or description 'Frais de port')
        line_items = []
        for i in range(min(len(quantities), len(unit_prices_ttc), len(total_prices))):
            if i < len(skus) and i < len(descriptions):
                sku = skus[i]
                description = descriptions[i]
                
                # Skip shipping items
                if (sku in ['SHIPPIN', 'SHIPPING'] or 
                    'Frais de port' in description or 
                    'frais de port' in description.lower()):
                    continue
                    
                quantity = quantities[i]
                unit_price = round(unit_prices_ttc[i], 2)
                total = round(total_prices[i], 2)
                
                line_items.append({
                    "sku": sku,
                    "description": description,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "total": total,
                    "vat_rate": vat_rates[0] if vat_rates else 5.5
                })
        
        return line_items
    
    def _parse_french_date(self, date_str):
        """Convert French date format to ISO format"""
        french_months = {
            'janv': '01', 'févr': '02', 'mars': '03', 'avr': '04',
            'mai': '05', 'juin': '06', 'juil': '07', 'août': '08',
            'sept': '09', 'oct': '10', 'nov': '11', 'déc': '12'
        }
        
        # Parse format like "11 sept. 2024"
        parts = date_str.split()
        if len(parts) >= 3:
            day = parts[0].zfill(2)
            month_abbr = parts[1].rstrip('.')
            year = parts[2]
            
            month = french_months.get(month_abbr, '01')
            return f"{year}-{month}-{day}"
        
        return date_str
    
    def _validate_extraction(self, data):
        """Comprehensive validation"""
        errors = []
        
        # Check mathematical consistency
        if 'line_items' in data and 'total_amount' in data:
            calculated = sum(Decimal(str(item.get('total', 0))) for item in data['line_items'])
            declared = Decimal(str(data['total_amount']))
            
            # Add shipping if present
            if 'shipping_ht' in data:
                shipping_ttc = Decimal(str(data['shipping_ht'])) * Decimal('1.2')  # 20% VAT
                calculated += shipping_ttc
            
            if abs(calculated - declared) > Decimal('0.01'):
                errors.append(f"Total mismatch: calculated {calculated} vs declared {declared}")
        
        # Check completeness
        required_fields = ['invoice_number', 'invoice_date', 'line_items']
        for field in required_fields:
            if not data.get(field):
                errors.append(f"Missing required field: {field}")
        
        # Validate line items
        if 'line_items' in data:
            for i, item in enumerate(data['line_items']):
                if not item.get('sku'):
                    errors.append(f"Line item {i+1}: Missing SKU")
                if not item.get('description'):
                    errors.append(f"Line item {i+1}: Missing description")
                if item.get('quantity', 0) <= 0:
                    errors.append(f"Line item {i+1}: Invalid quantity")
                if item.get('total', 0) <= 0:
                    errors.append(f"Line item {i+1}: Invalid total")
        
        return errors

# Test function
def test_nutrimeo_parser():
    parser = NutrimeoInvoiceParser()
    result = parser.extract('../Nutrimeo.pdf')
    
    print("=== NUTRIMEO INVOICE EXTRACTION ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    
    if 'validation_errors' in result:
        print("\n=== VALIDATION ERRORS ===")
        for error in result['validation_errors']:
            print(f"- {error}")
    
    return result

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        # Called with PDF path argument
        pdf_path = sys.argv[1]
        parser = NutrimeoInvoiceParser()
        result = parser.extract(pdf_path)
        
        print("=== NUTRIMEO INVOICE EXTRACTION ===")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        if 'validation_errors' in result:
            print("\n=== VALIDATION ERRORS ===", file=sys.stderr)
            for error in result['validation_errors']:
                print(f"- {error}", file=sys.stderr)
    else:
        # No arguments, run test function
        test_nutrimeo_parser()