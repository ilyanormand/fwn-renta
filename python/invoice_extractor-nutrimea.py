import re
import json
from decimal import Decimal
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams

class NutrimeaInvoiceParser:
    def __init__(self):
        self.supplier_name = "Nutrimea"
        self.currency = "EUR"  # From the PDF using €

    def extract(self, pdf_path):
        """Main extraction method with error handling"""
        try:
            # Extract text with layout analysis
            laparams = LAParams(boxes_flow=0.0, word_margin=0.1)
            raw_text = extract_text(pdf_path, laparams=laparams)
            
            # Parse components
            header_info = self._extract_header_info(raw_text)
            line_items = self._extract_line_items(raw_text)
            
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
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        
        header = {}
        
        try:
            i = lines.index('Numéro de facture')
            header['invoice_number'] = lines[i+5]
            header['invoice_date'] = lines[i+6]
            header['order_reference'] = ' '.join(lines[i+7:i+9])
            header['order_date'] = lines[i+9]
            header['tva_number'] = lines[i+10]
        except (ValueError, IndexError):
            pass
        
        # Extract total amount
        try:
            for j in range(len(lines)-1, -1, -1):
                if lines[j] == 'Total':
                    next_line = lines[j+1]
                    total_match = re.match(r'^([\d ]+,\d{2}) €$', next_line)
                    if total_match:
                        total_str = total_match.group(1).replace(' ', '').replace(',', '.')
                        header['total_amount'] = Decimal(total_str)
                        break
        except ValueError:
            pass
        
        return header
    
    def _extract_line_items(self, text):
        """Extract product line items with cross-page reconstruction"""
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        
        # Find table start and end
        try:
            table_start = lines.index('Référence')
            table_end = lines.index('Total produits')
        except ValueError:
            return []
        
        table_lines = lines[table_start:table_end]
        
        # Collect references
        refs = [l for l in table_lines if re.match(r'^\d{3,}(?:_NUT)?$', l)]
        
        # Collect product lines
        product_lines = [l for l in table_lines if re.search(r'[A-Za-z]', l) and ('*' in l or 'FR' in l)]
        
        # Group product descriptions (every 2 lines)
        descriptions = [' '.join(product_lines[i:i+2]) for i in range(0, len(product_lines), 2)]
        
        # Collect data tokens (prices and quantities, excluding refs)
        data_tokens = [l for l in table_lines if re.match(r'^\d+,\d{2} €|^\d+$', l) and l not in refs]
        print("Debug: data_tokens =", data_tokens)
        
        # Parse data tokens into unit_prices, qtys, totals using group collection
        unit_prices = []
        qtys = []
        totals = []
        i = 0
        while i < len(data_tokens):
            current_unit = []
            while i < len(data_tokens) and re.match(r'^\d+,\d{2} €$', data_tokens[i]):
                current_unit.append(data_tokens[i])
                i += 1
            
            current_qty = []
            while i < len(data_tokens) and re.match(r'^\d+$', data_tokens[i]):
                current_qty.append(data_tokens[i])
                i += 1
            
            current_total = []
            expected = len(current_qty)
            for _ in range(expected):
                if i < len(data_tokens) and re.match(r'^\d+,\d{2} €$', data_tokens[i]):
                    current_total.append(data_tokens[i])
                    i += 1
                else:
                    break
            
            if current_unit and current_qty and current_total and len(current_unit) == len(current_qty) == len(current_total):
                unit_prices.extend(current_unit)
                qtys.extend(current_qty)
                totals.extend(current_total)
        
        # Build line items
        line_items = []
        print("Debug: len(refs) =", len(refs))
        print("Debug: len(product_lines) =", len(product_lines))
        print("Debug: len(descriptions) =", len(descriptions))
        print("Debug: len(data_tokens) =", len(data_tokens))
        print("Debug: len(unit_prices) =", len(unit_prices))
        print("Debug: len(qtys) =", len(qtys))
        print("Debug: len(totals) =", len(totals))
        num_items = min(len(refs), len(descriptions), len(unit_prices), len(qtys), len(totals))
        for idx in range(num_items):
            unit_str = unit_prices[idx].replace(' €', '').replace(',', '.')
            total_str = totals[idx].replace(' €', '').replace(',', '.')
            line_items.append({
                'reference': refs[idx],
                'description': descriptions[idx],
                'unit_price': Decimal(unit_str),
                'quantity': int(qtys[idx]),
                'total': Decimal(total_str)
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
        
        return errors


if __name__ == "__main__":
    import sys
    pdf_path = '/Users/assanali.aukenov/Projects/parsers/Nutrimea/test/Nutrimea.pdf'
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    parser = NutrimeaInvoiceParser()
    result = parser.extract(pdf_path)
    print(json.dumps(result, indent=2, default=str))
    if 'validation_errors' in result:
        print("\nValidation Errors:")
        for error in result['validation_errors']:
            print(error)