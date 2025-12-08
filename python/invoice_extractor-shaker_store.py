from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

def extract_invoice_data(pdf_path):
    """Extract data from Shaker Store invoices"""
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

    return parse_invoice_text(full_text)

def parse_invoice_text(text: str):
    """Parse Shaker Store invoice text"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Helper function to parse decimal numbers
    def parse_number(s: str) -> float:
        if not s:
            return 0.0
        # Clean the string
        s = s.replace('€', '').replace('EUR', '').replace('$', '').strip()
        s = re.sub(r'[^\d,.-]', '', s)
        
        # Handle comma as thousands separator or decimal
        if ',' in s:
            # If comma is followed by exactly 2 digits, it's decimal
            if re.search(r',\d{2}$', s):
                s = s.replace(',', '.')
            else:
                # Otherwise it's thousands separator
                s = s.replace(',', '')
        
        try:
            return float(s)
        except ValueError:
            return 0.0

    # Extract vendor information
    if 'shaker' in text.lower():
        invoice_data['vendor']['name'] = 'Shaker Store'

    # Extract customer information
    customer_match = re.search(r'(FITNESS WORLD NUTRITION|FWN)', text, re.IGNORECASE)
    if customer_match:
        invoice_data['customer']['name'] = customer_match.group(1)

    # Extract invoice metadata
    invoice_num_match = re.search(r'(?:Invoice|Számla).*?(\d{4,})', text, re.IGNORECASE)
    if invoice_num_match:
        invoice_data['metadata']['invoice_number'] = invoice_num_match.group(1)

    # Extract delivery note
    delivery_note_match = re.search(r'(?:Delivery Note|Szállítólevél).*?(\d+)', text, re.IGNORECASE)
    if delivery_note_match:
        invoice_data['metadata']['delivery_note'] = delivery_note_match.group(1)

    # Extract date
    date_match = re.search(r'(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{4})', text)
    if date_match:
        invoice_data['metadata']['invoice_date'] = date_match.group(1)

    # Extract order items
    lines = text.split('\n')
    i = 0
    
    # Track shipping fee separately
    shipping_fee = 0.0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Look for delivery/shipping lines first
        if any(word in line.lower() for word in ['delivery', 'szállítás', 'shipping']):
            # Extract price for delivery
            price_match = re.search(r'(\d+[.,]\d{2})', line)
            if price_match:
                shipping_fee = parse_number(price_match.group(1))
                print(f"Found shipping fee: {shipping_fee}")
            i += 1
            continue
        
        # Look for product lines with quantity patterns like "800 pcs/"
        if re.search(r'\d+\s*pcs', line, re.IGNORECASE):
            # Extract quantity
            qty_match = re.search(r'(\d+)\s*pcs', line, re.IGNORECASE)
            quantity = int(qty_match.group(1)) if qty_match else 0
            
            # Initialize with defaults
            reference = "UNKNOWN"
            description = "Product"
            
            # Check if this is a delivery/shipping line by looking at nearby context
            is_delivery = False
            for j in range(max(0, i-2), min(len(lines), i+3)):
                check_line = lines[j].strip()
                if any(word in check_line.lower() for word in ['delivery', 'szállítás', 'shipping']) and quantity == 1:
                    # Check if this is specifically the delivery charge (higher price)
                    price_matches = re.findall(r'(\d+[.,]\d{2})', line)
                    if price_matches:
                        price_val = parse_number(price_matches[-1])
                        # Only treat as delivery if price is high (like 350) not low (like 7)
                        if price_val > 50:  # Delivery is typically more expensive than pallet
                             is_delivery = True
                             shipping_fee = price_val
                             # Debug message sent to stderr to avoid JSON parsing issues
                             import sys
                             print(f"Found delivery line with shipping fee: {shipping_fee}", file=sys.stderr)
                             break
            
            # Skip delivery items - they are handled as shipping fee
            if is_delivery:
                i += 1
                continue
            
            # Parse line format: position quantity unit SKU description price total
            # Example: "1 800 pcs SSSP0524 Fitness World Nutrition Dark Opaque 500+150ml 1.65 1,320.00"
            line_parts = line.split()
            

            
            # Initialize with defaults
            reference = "UNKNOWN"
            description = "Product"
            
            # First, try to find SKU in the current line (like 39241000 at the beginning)
            first_part = line_parts[0] if line_parts else ""
            if len(first_part) >= 4 and first_part.isalnum() and first_part not in ['EUR', 'USD', 'GBP', 'HUF']:
                reference = first_part
            
            # Try to find description and extract SKU from nearby lines
            for offset in [-2, -1, 1, 2]:
                nearby_idx = i + offset
                if 0 <= nearby_idx < len(lines):
                    nearby_line = lines[nearby_idx]
                    
                    # Skip lines that look like other order items or totals
                    if re.search(r'\b\d+\s*(pcs?|pc)', nearby_line, re.IGNORECASE):
                        continue
                    if re.search(r'\b\d+[.,]\d+\s*€', nearby_line):
                        continue
                        
                    # Clean the nearby line and use as description
                    clean_desc = re.sub(r'\b\d+[.,]\d+\b', '', nearby_line)  # Remove prices
                    clean_desc = re.sub(r'[€$£¥]', '', clean_desc)  # Remove currency symbols
                    clean_desc = re.sub(r'\s+', ' ', clean_desc).strip()  # Clean whitespace
                    
                    # Skip table headers and unwanted text
                    skip_patterns = [
                        r'VTSZ.*SZJ.*Menny',  # Table headers
                        r'Nett.*rt.*k.*FA',   # More table headers
                        r'^\d+\s*$',          # Just numbers
                        r'Page \d+',          # Page numbers
                        r'Invoice.*\d+',      # Invoice headers
                    ]
                    
                    should_skip = False
                    for pattern in skip_patterns:
                        if re.search(pattern, clean_desc, re.IGNORECASE):
                            should_skip = True
                            break
                    
                    # Only use if it looks like a product description
                    if not should_skip and clean_desc and len(clean_desc) > 10 and not clean_desc.isdigit():
                        description = clean_desc
                        
                        # Extract SKU from the description text
                        # Look for patterns like SSSP0524, OWPAL, etc.
                        sku_patterns = [
                            r'\b([A-Z]{2,}\d{4,})\b',     # Pattern like SSSP0524
                            r'\b([A-Z]{4,}\d*)\b',       # Pattern like OWPAL
                            r'\b([A-Z]+[A-Z0-9]{3,})\b', # General alphanumeric SKU
                        ]
                        
                        for pattern in sku_patterns:
                            sku_match = re.search(pattern, clean_desc)
                            if sku_match:
                                potential_sku = sku_match.group(1)
                                # Exclude common words that might match the pattern
                                if potential_sku not in ['EUR', 'USD', 'GBP', 'HUF', 'PAGE', 'INVOICE', 'TOTAL', 'WORLD', 'FITNESS', 'NUTRITION']:
                                    reference = potential_sku
                                    break
                        
                        break  # Found a good description, stop looking
            
            # Fallback: look in nearby lines for SKU if still not found
            if not reference:
                for j in range(max(0, i-2), min(len(lines), i+3)):
                    check_line = lines[j].strip()
                    
                    # Look for SKU
                    sku_match = re.search(r'\b([A-Z0-9]{4,}(?:[-_][A-Z0-9]+)?)\b', check_line)
                    if sku_match and sku_match.group(1) not in ['EUR', 'USD', 'GBP', 'HUF']:
                        reference = sku_match.group(1)
                        break
            
            # Extract prices from the line
            unit_price = 0.0
            total_price = 0.0
            
            # Look for price patterns in current and nearby lines
            price_matches = re.findall(r'(\d+[.,]\d{2})', line)
            if len(price_matches) >= 2:
                # Assume first price is unit price, last is total
                unit_price = parse_number(price_matches[0])
                total_price = parse_number(price_matches[-1])
            elif len(price_matches) == 1:
                # Try to determine if it's unit or total price
                price_val = parse_number(price_matches[0])
                if quantity > 0:
                    # If price * quantity makes sense, it's unit price
                    if abs(price_val * quantity - price_val) > price_val:  # Not 1:1 ratio
                        unit_price = price_val
                        total_price = unit_price * quantity
                    else:
                        total_price = price_val
                        unit_price = total_price / quantity if quantity > 0 else 0
            
            # Add the item if we have valid data
            if quantity > 0 and (unit_price > 0 or total_price > 0):
                if unit_price == 0 and total_price > 0:
                    unit_price = total_price / quantity
                elif total_price == 0 and unit_price > 0:
                    total_price = unit_price * quantity
                
                invoice_data['order_items'].append({
                    'position': str(len(invoice_data['order_items']) + 1),
                    'quantity': str(quantity),
                    'article_number': reference,
                    'description': description,
                    'unit_price': f"{unit_price:.2f}",
                    'total_price': f"{total_price:.2f}"
                })
        
        # Skip pallet/shipping items as they are handled separately above
        elif any(word in line.lower() for word in ['pallet', 'one way', 'shipping']):
            # These are handled in the delivery section above
            pass
        
        i += 1

    # Calculate totals from all order items (shipping is handled separately)
    subtotal = sum(parse_number(item['total_price']) for item in invoice_data['order_items'])
    
    # Try to extract total from text patterns
    total_patterns = [
        r'Total.*?([\d,]+\.\d{2})',
        r'([\d,]+\.\d{2})\s*$',  # Last number on a line
        r'Total\s+([\d,]+\.\d{2})',
        r'Amount.*?([\d,]+\.\d{2})'
    ]
    
    total = None
    for pattern in total_patterns:
        total_match = re.search(pattern, text, re.MULTILINE)
        if total_match:
            total_str = total_match.group(1).replace(',', '')
            total_val = parse_number(total_str)
            # Validate that total makes sense (should be >= subtotal)
            if total_val >= subtotal:
                total = f"{total_val:.2f}"
                break
    
    # If no valid total found, calculate it
    if not total:
        total = f"{subtotal + shipping_fee:.2f}"
    
    invoice_data['totals']['subtotal'] = f"{subtotal:.2f}"
    invoice_data['totals']['total'] = total
    invoice_data['totals']['amount_to_pay'] = total
    
    # Add shipping fee to metadata if present
    if shipping_fee > 0:
        invoice_data['metadata']['shipping_fee'] = f"{shipping_fee:.2f}"

    return invoice_data

if __name__ == "__main__":
    args = sys.argv[1:]
    pdf_path = "Shaker store.pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    try:
        data = extract_invoice_data(pdf_path)
        if json_flag:
            # Ensure vendor name is set
            if not data.get('vendor') or not data['vendor'].get('name'):
                data['vendor'] = {'name': 'Shaker Store'}
            print(json.dumps(data, ensure_ascii=True))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        if json_flag:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}")