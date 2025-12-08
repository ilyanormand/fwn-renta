import re
import json
from decimal import Decimal
from pdfminer.layout import LAParams, LTTextBoxHorizontal
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator

class NakosportInvoiceParser:
    def __init__(self):
        self.supplier_name = "Nakosport"
        self.currency = "EUR"  # EUR, USD, etc.

    def extract(self, pdf_path):
        """Main extraction method with error handling"""
        try:
            rsrcmgr = PDFResourceManager()
            laparams = LAParams(boxes_flow=0.5, word_margin=0.1, line_margin=0.5, char_margin=2.0)
            device = PDFPageAggregator(rsrcmgr, laparams=laparams)
            interpreter = PDFPageInterpreter(rsrcmgr, device)
            all_rows = []
            header_info = {}
            with open(pdf_path, 'rb') as fp:
                for page in PDFPage.get_pages(fp):
                    interpreter.process_page(page)
                    layout = device.get_result()
                    text_elements = []
                    for element in layout:
                        if isinstance(element, LTTextBoxHorizontal):
                            for text_line in element:
                                if hasattr(text_line, 'get_text'):
                                    text = text_line.get_text().strip()
                                    if text:
                                        x0, y0, x1, y1 = text_line.bbox
                                        text_elements.append((text, (y0 + y1) / 2, x0))
                    # Sort by y descending (top to bottom)
                    text_elements.sort(key=lambda e: -e[1])
                    print("Sorted y for page: " + str([round(e[1], 2) for e in text_elements]))
                    # Group into rows
                    rows = []
                    current_row = []
                    prev_y = None
                    tolerance = 5
                    for text, y, x in text_elements:
                        if prev_y is None or abs(y - prev_y) <= tolerance:
                            current_row.append((text, x))
                        else:
                            if current_row:
                                current_row.sort(key=lambda item: item[1])  # sort by x
                                rows.append([item[0] for item in current_row])
                            current_row = [(text, x)]
                        prev_y = y
                    if current_row:
                        current_row.sort(key=lambda item: item[1])
                        rows.append([item[0] for item in current_row])
                    all_rows.extend(rows)
                    # Debug print rows with multiple elements
                    for row in rows:
                        if len(row) >= 5:
                            print(f"Potential table row: {row}")
            # Now process all_rows for header and line items
            line_items = self._extract_line_items(all_rows)
            header_info = self._extract_header_info(all_rows)
            calculated_subtotal = sum(item['total'] for item in line_items)
            calculated_total = calculated_subtotal + header_info.get('shipping_cost', Decimal(0))
            # Build result
            result = {
                **header_info,
                'calculated_subtotal': calculated_subtotal,
                'calculated_total': calculated_total,
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

    def _extract_header_info(self, rows):
        header = {}
        full_text = '\n'.join(' '.join(row) for row in rows)
        print("Full text for header extraction:\n", full_text)
        # Invoice Number
        match = re.search(r'Invoice Number: ?(\d+)', full_text)
        if match:
            header['invoice_number'] = match.group(1)
        # Reference Number
        match = re.search(r'Reference Number: (\w+)', full_text)
        if match:
            header['reference_number'] = match.group(1)
        # Customer Number
        match = re.search(r'Customer Number: (\d+)', full_text)
        if match:
            header['customer_number'] = match.group(1)
        # Invoice Date
        match = re.search(r'Invoice Date: ?([\d.]+)', full_text)
        if match:
            header['invoice_date'] = match.group(1)
        # Order Date
        match = re.search(r'Order date: ([\d.]+)', full_text)
        if match:
            header['order_date'] = match.group(1)
        # Subtotal
        match = re.search(r'Subtotal \(exclusive VAT\): ?([\d.,]+) €', full_text)
        if match:
            header['subtotal'] = Decimal(match.group(1).replace(',', ''))
        # Total
        match = re.search(r'Order total \(incl. VAT\): ?([\d.,]+) €', full_text)
        if match:
            header['total_amount'] = Decimal(match.group(1).replace(',', ''))
        # Shipping Cost
        match = re.search(r'Shipping Costs \(excl. VAT\): ([\d.,]+) €', full_text)
        if match:
            header['shipping_cost'] = Decimal(match.group(1).replace(',', ''))
        return header

    def _extract_line_items(self, rows):
        line_items = []
        in_table = False
        for row in rows:
            if len(row) >= 7 and 'Brand' in row and 'Product' in row and 'Flavour' in row and 'Price' in row and 'Quantity' in row and 'VAT' in row and 'Sum (ex.)' in row:
                in_table = True
                print(f"Found header row: {row}")
                continue
            if in_table and len(row) >= 7:
                try:
                    item = {
                        'sku': '',
                        'brand': row[0],
                        'description': row[1],
                        'flavour': row[2],
                        'unit_price': Decimal(row[3].replace(' €', '').replace(',', '')),
                        'quantity': int(row[4]),
                        'vat': int(row[5].replace(' %', '')),
                        'total': Decimal(row[6].replace(' €', '').replace(',', ''))
                    }
                    line_items.append(item)
                except Exception as e:
                    print(f"Failed to parse row: {row} - Error: {str(e)}")
            elif in_table and len(row) == 2 and row[0] == 'FID:':
                if line_items:
                    line_items[-1]['sku'] = row[1]
            elif in_table and len(row) == 1 and row[0].startswith('FID:'):
                if line_items:
                    line_items[-1]['sku'] = row[0].split(':')[1].strip()
        return line_items

    def _validate_extraction(self, data):
        """Comprehensive validation"""
        errors = []
        # Check mathematical consistency
        if 'line_items' in data and 'subtotal' in data:
            calculated = sum(Decimal(str(item.get('total', 0))) for item in data['line_items'])
            declared = data['subtotal']
            if abs(calculated - declared) > Decimal('0.01'):
                errors.append(f"Subtotal mismatch: calculated {calculated} vs declared {declared}")
        # Check completeness
        required_fields = ['invoice_number', 'invoice_date', 'line_items']
        for field in required_fields:
            if not data.get(field):
                errors.append(f"Missing required field: {field}")
        # Check line items have required keys
        if 'line_items' in data:
            for item in data['line_items']:
                if 'product' not in item or 'quantity' not in item or 'price' not in item:
                    errors.append("Incomplete line item")
                    break
        return errors


if __name__ == "__main__":
    import sys
    parser = NakosportInvoiceParser()
    result = parser.extract(sys.argv[1])
    print(json.dumps(result, indent=2, default=str))