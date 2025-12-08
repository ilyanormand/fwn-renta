import re
from datetime import datetime
import pdfplumber

class OstrovitInvoiceParserV2:
    def __init__(self):
        self.supplier_name = "Ostrovit"
        self.currency = "EUR"

    def extract(self, pdf_path: str) -> dict:
        with pdfplumber.open(pdf_path) as pdf:
            raw_text = "\n".join(page.extract_text() for page in pdf.pages if page.extract_text())

        header_info = self._extract_header_info(raw_text)
        line_items = self._extract_line_items(raw_text)

        extracted_data = {
            "invoice_number": header_info.get("invoice_number"),
            "invoice_date": header_info.get("invoice_date"),
            "line_items": line_items,
            "supplier": self.supplier_name,
            "currency": self.currency,
            "validation_errors": self._validate_extracted_data(header_info, line_items)
        }

        return extracted_data

    def _extract_header_info(self, raw_text):
        header_info_match = re.search(
            r"Invoice\s+(?P<invoice_number>FS/\d{4}/\d{2}/\d{5}).*?"
            r"Sale Date:\s+Issue Date:.*?\n"
            r".*?\s+(?P<sale_date>\d{2}\.\d{2}\.\d{4})\s+(?P<issue_date>\d{2}\.\d{2}\.\d{4})",
            raw_text,
            re.DOTALL
        )

        if header_info_match:
            data = header_info_match.groupdict()
            day, month, year = data['issue_date'].split('.')
            invoice_date = f"{year}-{month}-{day}"
            return {
                "invoice_number": data['invoice_number'],
                "invoice_date": invoice_date,
            }
        return {}

    def _extract_line_items(self, raw_text):
        line_items = []
        line_items_block_match = re.search(r"GROSS\nVALUE VALUE\n(.*?)\nUntaxed Amount", raw_text, re.DOTALL)
        if not line_items_block_match:
            return []

        items_text = line_items_block_match.group(1)
        item_lines_text = re.split(r'\n(?=\d+\s+\[\d+\])', items_text.strip())

        for item_text in item_lines_text:
            item_text = item_text.replace('\n', ' ')
            # More flexible pattern to handle complex descriptions and mixed content
            # First, try to extract the core components using a more flexible approach
            
            # Extract SKU first
            sku_match = re.search(r'^\d+\s+\[(?P<sku>\d+)\]', item_text)
            if not sku_match:
                continue
                
            sku = sku_match.group('sku')
            
            # Find the price pattern at the end: quantity Units vat% unit_price discount net_value € total_price €
            # Use simpler pattern that works for all items
            price_pattern = re.search(
                r'(?P<quantity>[\d.]+)\s+Units\s+(?P<vat>\d+)%\s+(?P<unit_price>[\d.]+)\s+(?P<discount>[\d.]+)\s+(?P<net_value>[\d,.]+)\s+€\s+(?P<total_price>[\d,.]+)\s+€',
                item_text
            )
            
            if not price_pattern:
                continue
                
            # Extract description between SKU and the numeric codes
            sku_end = sku_match.end()
            price_start = price_pattern.start()
            
            # Find CN CODE and EAN in the middle part
            middle_part = item_text[sku_end:price_start]
            
            # Look for CN CODE (8+ digits) and EAN (10+ digits)
            codes_match = re.search(r'(\d{8,})\s+(\d{10,})', middle_part)
            if not codes_match:
                continue
                
            # Description is everything before the codes
            description_end = middle_part.find(codes_match.group(0))
            description = middle_part[:description_end].strip()
            
            # Clean up description
            description = re.sub(r'\s+(crunchy|smooth)\)?$', ')', description)
            description = re.sub(r'\s+$', '', description)  # Remove trailing spaces
            
            # Extract price data
            price_data = price_pattern.groupdict()
            total_price_str = price_data['total_price'].replace(',', '')
            
            line_items.append({
                "sku": sku,
                "description": description,
                "quantity": int(float(price_data['quantity'])),
                "unit_price": float(price_data['unit_price']),
                "total": float(total_price_str)
            })
        return line_items

    def _validate_extracted_data(self, header_info, line_items):
        errors = []
        data = {**header_info, "line_items": line_items}

        required_fields = ['invoice_number', 'invoice_date', 'line_items']
        for field in required_fields:
            if not data.get(field):
                errors.append(f"Missing required field: {field}")
        
        return errors

if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        parser = OstrovitInvoiceParserV2()
        data = parser.extract(pdf_path)
        print(json.dumps(data, indent=4))