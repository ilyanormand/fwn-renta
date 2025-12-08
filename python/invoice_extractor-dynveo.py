from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

def extract_dynveo_invoice_data(pdf_path):
    """Extract data from Dynveo invoices"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Extract text with positioning information
    full_text = ""
    for page_num, page_layout in enumerate(extract_pages(pdf_path)):
        page_text = ""
        elements = []
        for element in page_layout:
            if isinstance(element, LTTextContainer):
                for text_line in element:
                    if hasattr(text_line, 'get_text'):
                        text = text_line.get_text().strip()
                        if text:
                            elements.append({'text': text, 'y': text_line.y0, 'x': text_line.x0})
        elements.sort(key=lambda x: (-x['y'], x['x']))
        current_y = None
        for elem in elements:
            if current_y is None or abs(current_y - elem['y']) > 5:
                if page_text:
                    page_text += '\n'
                current_y = elem['y']
            page_text += elem['text'] + ' '
        full_text += f"\n--- PAGE {page_num + 1} ---\n" + page_text

    return parse_dynveo_invoice_text(full_text)

def parse_dynveo_invoice_text(text: str):
    """Parse Dynveo invoice text with specialized logic for their format"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Extract vendor information
    vendor_match = re.search(r'DYNVEO', text, re.IGNORECASE)
    if vendor_match:
        invoice_data['vendor']['name'] = 'DYNVEO'

    # Extract customer information - look for company name patterns
    customer_match = re.search(r'(FITNESS WORLD NUTRITION|FWN)', text, re.IGNORECASE)
    if customer_match:
        invoice_data['customer']['name'] = customer_match.group(1)

    # Extract invoice metadata
    invoice_num_match = re.search(r'(?:Facture|Invoice).*?(\d{4,})', text, re.IGNORECASE)
    if invoice_num_match:
        invoice_data['metadata']['invoice_number'] = invoice_num_match.group(1)

    # Extract date
    date_match = re.search(r'(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})', text)
    if date_match:
        invoice_data['metadata']['invoice_date'] = date_match.group(1)

    # Extract order items - Dynveo specific format
    # Look for table with columns: Référence | Produit | Column3 | Prix unitaire | Quantité | Total
    lines = text.split('\n')
    i = 0
    in_table = False
    header_found = False
    
    # Helper function to parse decimal numbers
    def parse_number(s: str) -> float:
        if not s:
            return 0.0
        # Clean the string and handle French decimal format
        s = s.replace('€', '').replace('EUR', '').strip()
        s = re.sub(r'[^\d,.-]', '', s)
        
        # Handle French format: 1 234,56 or 1.234,56
        if ',' in s and '.' in s:
            # Format like 1.234,56
            if s.rfind(',') > s.rfind('.'):
                s = s.replace('.', '').replace(',', '.')
            else:
                # Format like 1,234.56
                s = s.replace(',', '')
        elif ',' in s:
            # Check if it's a decimal separator (,XX) or thousands separator
            parts = s.split(',')
            if len(parts) == 2 and len(parts[1]) <= 2:
                # Decimal separator
                s = s.replace(',', '.')
            else:
                # Thousands separator
                s = s.replace(',', '')
        
        try:
            return float(s)
        except ValueError:
            return 0.0

    while i < len(lines):
        line = lines[i].strip()
        
        # Look for table header indicators
        if ('référence' in line.lower() and 'produit' in line.lower()) or \
           ('prix unitaire' in line.lower() and 'quantité' in line.lower()):
            in_table = True
            header_found = True
            i += 1
            continue
            
        # Skip lines that are clearly not part of the product table
        if (not header_found or 
            '---' in line or
            'www.' in line.lower() or
            'page:' in line.lower() or
            line.startswith('--- PAGE') or
            'total' in line.lower() and 'ht' in line.lower() or
            'tva' in line.lower() or
            'ttc' in line.lower()):
            # Check for totals before skipping
            if 'total' in line.lower() or 'sous-total' in line.lower():
                # Look for patterns like "Total HT: 123.45" or "Sous-total: 123.45"
                total_match = re.search(r'([\d\s.,]+)\s*€?', line)
                if total_match:
                    total_str = total_match.group(1).strip()
                    total_val = parse_number(total_str)
                    if total_val > 0:
                        if 'ht' in line.lower() or 'sous-total' in line.lower():
                            invoice_data['totals']['subtotal'] = str(total_val)
                        elif 'ttc' in line.lower() or ('total' in line.lower() and 'ht' not in line.lower()):
                            invoice_data['totals']['total'] = str(total_val)
            i += 1
            continue
            
        # Look for product lines in table
        if in_table and line:
            # Try to extract product information using regex patterns
            # Pattern for Dynveo format: REF | PRODUCT_NAME | ... | PRICE | QTY | TOTAL
            
            # Look for lines with reference codes (letters/numbers)
            ref_match = re.match(r'^([A-Z0-9\-_]+)', line)
            if ref_match:
                reference = ref_match.group(1)
                
                # Extract the rest of the line for parsing
                remaining_line = line[len(reference):].strip()
                
                # Look for price and quantity patterns at the end
                # Pattern: ... PRICE QTY TOTAL (with € symbols)
                price_qty_pattern = r'([\d\s.,]+)€?\s+([\d\s.,]+)\s+([\d\s.,]+)€?\s*$'
                price_qty_match = re.search(price_qty_pattern, remaining_line)
                
                if price_qty_match:
                    unit_price_str = price_qty_match.group(1).strip()
                    quantity_str = price_qty_match.group(2).strip()
                    total_str = price_qty_match.group(3).strip()
                    
                    unit_price = parse_number(unit_price_str)
                    quantity = parse_number(quantity_str)
                    total = parse_number(total_str)
                    
                    # Extract description (everything between reference and price info)
                    desc_end = price_qty_match.start()
                    description = remaining_line[:desc_end].strip()
                    
                    # Look ahead for continuation lines
                    j = i + 1
                    while j < len(lines) and j < i + 3:  # Look at next few lines
                        next_line = lines[j].strip()
                        if (not next_line or 
                            re.match(r'^[A-Z0-9\-_]+', next_line) or  # Next product
                            'total' in next_line.lower() or
                            re.search(r'[\d.,]+€', next_line)):  # Contains prices
                            break
                        description += ' ' + next_line
                        j += 1
                    
                    # Clean up description
                    description = re.sub(r'\s+', ' ', description).strip()
                    # Remove common artifacts from overlapping text
                    description = re.sub(r'\s*5\.5\s*%', '', description).strip()
                    description = re.sub(r'\s*€\s*', ' ', description).strip()
                    
                    # Validate the data makes sense and avoid duplicates
                    if unit_price > 0 and quantity > 0 and reference:
                        # Check for duplicates
                        existing_refs = [item['reference'] for item in invoice_data['order_items']]
                        if reference not in existing_refs:
                            invoice_data['order_items'].append({
                                'reference': reference,
                                'description': description,
                                'quantity': str(int(quantity)),
                                'unit_price': f"{unit_price:.2f}",
                                'total': f"{total:.2f}"
                            })
                    
                    i = j - 1  # Skip processed lines
        
        i += 1

    # Extract totals if not found in table processing
    if not invoice_data['totals']:
        # Look for total patterns in the text
        total_ht_match = re.search(r'Total\s*HT\s*[:\s]*€?\s*([\d\s.,]+)', text, re.IGNORECASE)
        if total_ht_match:
            invoice_data['totals']['subtotal'] = total_ht_match.group(1).replace(',', '.').replace(' ', '')
        
        # Try alternative patterns for totals
        total_match = re.search(r'Total.*?€\s*([\d\s.,]+)', text, re.IGNORECASE)
        if total_match:
            total_val = total_match.group(1).replace(',', '.').replace(' ', '')
            if 'subtotal' not in invoice_data['totals']:
                invoice_data['totals']['subtotal'] = total_val
            invoice_data['totals']['total'] = total_val
        
        # Calculate totals from line items if not found
        if not invoice_data['totals'].get('subtotal') and invoice_data['order_items']:
            subtotal = sum(parse_number(item['total']) for item in invoice_data['order_items'])
            invoice_data['totals']['subtotal'] = f"{subtotal:.2f}"
            invoice_data['totals']['total'] = f"{subtotal:.2f}"

    return invoice_data

if __name__ == "__main__":
    args = sys.argv[1:]
    pdf_path = "Dynveo.pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    try:
        data = extract_dynveo_invoice_data(pdf_path)
        if json_flag:
            print(json.dumps(data, ensure_ascii=True))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        if json_flag:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}")
