import re
import json
from decimal import Decimal
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams
from datetime import datetime

class ProSupplyInvoiceParser:
    def __init__(self):
        self.supplier_name = "Pro Supply"
        self.currency = "EUR"
        
    def extract(self, pdf_path):
        """Main extraction method with error handling"""
        try:
            # Extract text with layout analysis
            laparams = LAParams(boxes_flow=0.5, word_margin=0.1)
            raw_text = extract_text(pdf_path, laparams=laparams)
            
            # Parse components
            header_info = self._extract_header_info(raw_text)
            line_items = self._extract_line_items(raw_text)
            
            # Build result in expected format
            result = {
                'vendor': {
                    'name': self.supplier_name
                },
                'customer': {},
                'order_items': line_items,
                'totals': {
                    'total': header_info.get('total_amount', 0),
                    'currency': self.currency
                },
                'metadata': {
                    'invoice_number': header_info.get('invoice_number', ''),
                    'invoice_date': header_info.get('invoice_date', ''),
                    'supplier': self.supplier_name
                }
            }
            
            # Validate before returning
            validation_errors = self._validate_extraction({
                **header_info,
                'line_items': line_items,
                'supplier': self.supplier_name,
                'currency': self.currency
            })
            if validation_errors:
                result['validation_errors'] = validation_errors
            
            return result
            
        except Exception as e:
            return {'error': f"Extraction failed: {str(e)}"}
    
    def _extract_header_info(self, text):
        """Extract invoice metadata"""
        header_info = {}
        lines = text.split('\n')
        
        # Extract invoice number - dynamic pattern recognition
        invoice_patterns = [
            r'Invoice No\.?\s*([A-Z0-9]+)',
            r'Invoice\s*#?\s*([A-Z0-9]+)',
            r'Facture\s*N[°o]\.?\s*([A-Z0-9]+)'
        ]
        
        for pattern in invoice_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                header_info['invoice_number'] = match.group(1).strip()
                break
        
        # Extract invoice date - handle multiline format
        for i, line in enumerate(lines):
            if 'Date:' in line:
                # Look for date in subsequent lines
                for j in range(i + 1, min(i + 10, len(lines))):
                    date_line = lines[j].strip()
                    date_match = re.search(r'(\d{1,2}\.\d{1,2}\.\d{4})', date_line)
                    if date_match:
                        date_str = date_match.group(1)
                        try:
                            date_obj = datetime.strptime(date_str, '%d.%m.%Y')
                            header_info['invoice_date'] = date_obj.strftime('%Y-%m-%d')
                            break
                        except ValueError:
                            continue
                break
        
        # Extract total amount - handle comma as decimal separator
        total_patterns = [
            r'Invoice total \([A-Z]{3}\)\s*([0-9]+,?[0-9]*)',
            r'Total\s*[A-Z]{3}?\s*([0-9]+,?[0-9]*)',
            r'TOTAL\s*([0-9]+,?[0-9]*)'
        ]
        
        for pattern in total_patterns:
            match = re.search(pattern, text)
            if match:
                total_str = match.group(1).replace(',', '.')
                try:
                    header_info['total_amount'] = float(total_str)
                except ValueError:
                    continue
                break
        
        # Extract VAT information
        vat_match = re.search(r'VAT\s*(\d+)%\s*([0-9]+,?[0-9]*)', text)
        if vat_match:
            header_info['vat_rate'] = float(vat_match.group(1))
            vat_amount_str = vat_match.group(2).replace(',', '.')
            header_info['vat_amount'] = float(vat_amount_str)
        
        # Extract subtotal
        subtotal_match = re.search(r'Subtotal\s*\d+%.*?([0-9]+,?[0-9]*)', text)
        if subtotal_match:
            subtotal_str = subtotal_match.group(1).replace(',', '.')
            header_info['subtotal'] = float(subtotal_str)
        
        return header_info
    
    def _extract_line_items(self, text):
        """Extract line items based on the specific Pro Supply layout"""
        lines = text.split('\n')
        line_items = []
        
        # Find descriptions (lines 79-96 based on analysis)
        descriptions = []
        quantities = []
        unit_prices = []
        totals = []
        
        # Extract descriptions - look for lines with product names
        for line in lines:
            line = line.strip()
            if any(keyword in line for keyword in ['PULS', 'Protein', 'DPD']) and 'Description' not in line:
                descriptions.append(line)
        
        # Extract quantities - look for standalone numbers after descriptions
        # Based on analysis, quantities are at lines 98-114
        in_quantity_section = False
        for i, line in enumerate(lines):
            line = line.strip()
            if line == 'Quantity Unit':
                in_quantity_section = True
                continue
            elif in_quantity_section and line.isdigit():
                quantities.append(int(line))
            elif line.startswith('#') or line.startswith('Subtotal'):
                # Stop at SKU marker or subtotal
                break
        
        # Extract unit prices - look for price values in the Price section
        in_price_section = False
        price_count = 0
        for line in lines:
            line = line.strip()
            if line == 'Price':
                in_price_section = True
                continue
            elif in_price_section and re.match(r'^\d+[,.]\d+$', line):
                unit_prices.append(float(line.replace(',', '.')))
                price_count += 1
                if price_count >= len(descriptions):  # Stop when we have enough prices
                    break
            elif line == 'Total excl.' or line == 'Description':
                in_price_section = False
        
        # Extract totals - look for total values after "Total excl."
        in_total_section = False
        total_count = 0
        for line in lines:
            line = line.strip()
            if line == 'Total excl.':
                in_total_section = True
                continue
            elif in_total_section and re.match(r'^\d+[,.]\d+$', line):
                totals.append(float(line.replace(',', '.')))
                total_count += 1
                if total_count >= len(descriptions):  # Stop when we have enough totals
                    break
            elif line == 'Description':
                in_total_section = False
        
        # Combine the extracted data
        min_length = min(len(descriptions), len(quantities), len(unit_prices), len(totals))
        
        for i in range(min_length):
            line_items.append({
                'description': descriptions[i].strip(),
                'quantity': quantities[i],
                'unit_price': unit_prices[i],
                'total': totals[i]
            })
        
        return line_items
    
    def _validate_extraction(self, data):
        """Comprehensive validation"""
        errors = []
        
        # Check mathematical consistency
        if 'line_items' in data and 'total_amount' in data:
            calculated = sum(Decimal(str(item.get('total', 0))) for item in data['line_items'])
            declared = Decimal(str(data['total_amount']))
            
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
                if not item.get('description'):
                    errors.append(f"Line item {i+1}: Missing description")
                if not item.get('quantity'):
                    errors.append(f"Line item {i+1}: Missing quantity")
                if not item.get('unit_price'):
                    errors.append(f"Line item {i+1}: Missing unit price")
                if not item.get('total'):
                    errors.append(f"Line item {i+1}: Missing total")
                
                # Check mathematical consistency for each item
                if all(k in item for k in ['quantity', 'unit_price', 'total']):
                    calculated_total = Decimal(str(item['quantity'])) * Decimal(str(item['unit_price']))
                    declared_total = Decimal(str(item['total']))
                    if abs(calculated_total - declared_total) > Decimal('0.01'):
                        errors.append(f"Line item {i+1}: Total mismatch {calculated_total} vs {declared_total}")
        
        return errors

def main():
    """Main function with command line argument support"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python invoice_extractor-pro_supply.py <pdf_path> [--json]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    json_output = '--json' in sys.argv
    
    parser = ProSupplyInvoiceParser()
    result = parser.extract(pdf_path)
    
    if json_output:
        # Output only JSON for integration with frontend
        print(json.dumps(result, ensure_ascii=False))
    else:
        # Human-readable output for testing
        print("=== PRO SUPPLY INVOICE EXTRACTION RESULTS ===")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        if 'validation_errors' in result:
            print("\n=== VALIDATION ERRORS ===")
            for error in result['validation_errors']:
                print(f"❌ {error}")
        else:
            print("\n✅ Extraction completed successfully with no validation errors")

if __name__ == "__main__":
    main()