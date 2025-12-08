import re
import json
import traceback
from decimal import Decimal, InvalidOperation
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams
import pdfplumber
import sys

class OstrovitInvoiceParser:
    def __init__(self):
        self.supplier_name = "Ostrovit"
        self.currency = "EUR"

    def extract(self, pdf_path):
        """Extracts invoice data from a PDF file."""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                raw_text = "\n".join(page.extract_text() for page in pdf.pages)

            # Try to extract data using format v1
            header_info = self._extract_header_info_v1(raw_text)
            line_items = self._extract_line_items_v1(raw_text)
            
            total_amount = sum(item.get('total', 0) for item in line_items)


            return {
                "vendor": {
                    "name": self.supplier_name
                },
                "metadata": {
                    "invoice_number": header_info.get("invoice_number"),
                    "invoice_date": header_info.get("invoice_date"),
                    "currency": self.currency
                },
                "totals": {
                    "total": total_amount
                },
                "order_items": line_items,
                "validation_errors": self._validate_extracted_data(header_info, line_items)
            }
        except Exception as e:
            return {
                "error": f"An error occurred: {e}",
                "validation_errors": ["Extraction failed due to an unexpected error."]
            }

    def _extract_header_info_v1(self, raw_text):
        """Extracts header information from the raw text of the PDF (format v1)."""
        header_re = re.compile(r"ODPOWIEDZIALNOŚCIĄ nr (FA/\d+/\d{2}/\d{4}/MAG)[\s\S]*?Date of issue: (\d{2}\.\d{2}\.\d{4})")
        header_match = header_re.search(raw_text)

        if header_match:
            day, month, year = header_match.group(2).split('.')
            invoice_date = f"{year}-{month}-{day}"
            return {
                "invoice_number": header_match.group(1),
                "invoice_date": invoice_date,
            }
        return {}

    def _extract_line_items_v1(self, raw_text):
        """Extracts line items from the raw text of the PDF (format v1)."""
        line_items = []
        
        line_items_block_match = re.search(r"Gross value EUR\n(.*?)\nWay of payment", raw_text, re.DOTALL)
        if not line_items_block_match:
            return []

        items_text = line_items_block_match.group(1)
        lines = items_text.strip().split('\n')
        
        item_lines = []
        current_item = []

        for line in lines:
            if re.match(r"^\d+\s", line): # Match digit followed by space
                if current_item:
                    item_lines.append(" ".join(current_item))
                current_item = [line]
            else:
                if current_item:
                    current_item.append(line.strip())
        if current_item:
            item_lines.append(" ".join(current_item))

        for item_line in item_lines:
            # Regex to find quantity, unit price, and total price
            match = re.search(r"(\d+)\s+pcs\.\s+0\s+%\s+([\d,]+\,\d{2})\s+([\d\s,]+\,\d{2})", item_line)
            if match:
                quantity = int(match.group(1))
                unit_price_str = match.group(2).replace(",", ".")
                unit_price = float(unit_price_str)
                total_price_str = match.group(3).replace(" ", "").replace(",", ".")
                total_price = float(total_price_str)

                # The description is everything before the match, and everything after.
                desc_part1 = item_line[:match.start()].strip()
                desc_part2 = item_line[match.end():].strip()
                
                full_description = (desc_part1 + " " + desc_part2).strip()

                # remove the leading item number from description
                desc_match = re.match(r"^\d+\s+(.*)", full_description)
                if desc_match:
                    description = desc_match.group(1).strip()
                else:
                    description = full_description

                # remove PKWiU code from description
                description = re.sub(r'\s+\d{2}\.\d{2}\.\d{2}\.\d', '', description).strip()


                line_items.append({
                    "reference": "",
                    "description": description,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "total": total_price
                })
        return line_items

    def _validate_extracted_data(self, header_info, line_items):
        """Comprehensive validation"""
        errors = []

        data = {**header_info, "line_items": line_items}

        # Check mathematical consistency
        if data.get('line_items') and data.get('total_amount'):
            calculated = sum(item.get('total', 0) for item in data['line_items'])
            declared = data['total_amount']

            if abs(calculated - declared) > 0.01:
                errors.append(f"Total mismatch: calculated {calculated:.2f} vs declared {declared:.2f}")

        # Check completeness
        required_fields = ['invoice_number', 'invoice_date', 'line_items']
        for field in required_fields:
            if not data.get(field):
                errors.append(f"Missing required field: {field}")
        
        return errors

if __name__ == "__main__":
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        parser = OstrovitInvoiceParser()
        data = parser.extract(pdf_path)
        print(json.dumps(data, indent=4))
    else:
        print(json.dumps({"error": "No PDF path provided"}))