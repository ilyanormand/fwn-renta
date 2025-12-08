from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

def extract_dsl_invoice_data(pdf_path):
    """Extract data from DSL Global invoices"""
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

    return parse_dsl_invoice_text(full_text)

def parse_dsl_invoice_text(text: str):
    """Parse DSL Global invoice text with specialized logic for their format"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Extract vendor information
    vendor_match = re.search(r'DSL Global\s+(.*?)\s+Tel', text, re.DOTALL)
    if vendor_match:
        vendor_address = vendor_match.group(1).replace('\n', ' ').strip()
        invoice_data['vendor']['name'] = 'DSL Global'
        invoice_data['vendor']['address'] = vendor_address

    # Extract customer information
    customer_match = re.search(r'Fitness World Nutrition\s+(.*?)\s+Frankrijk', text, re.DOTALL)
    if customer_match:
        customer_address = customer_match.group(1).replace('\n', ' ').strip()
        invoice_data['customer']['name'] = 'Fitness World Nutrition'
        invoice_data['customer']['address'] = customer_address

    # Extract invoice metadata
    invoice_match = re.search(r'Invoice\s+Your VAT-number\s+(.*?)\s+Invoicenumber\s+(\d+)', text, re.DOTALL)
    if invoice_match:
        vat_info = invoice_match.group(1).replace('\n', ' ').strip()
        invoice_number = invoice_match.group(2)
        invoice_data['metadata']['invoice_number'] = invoice_number
        
        # Extract VAT number and dates from the vat_info
        vat_match = re.search(r'FR\d+\s+\d+\s+(\d+\s+\w+\s+\d+)\s+(\d+\s+\w+\s+\d+)', vat_info)
        if vat_match:
            invoice_data['metadata']['invoice_date'] = vat_match.group(1)
            invoice_data['metadata']['expiration_date'] = vat_match.group(2)

    # Extract order items - DSL Global specific format
    lines = text.split('\n')
    i = 0
    in_table = False
    header_found = False
    
    # Remove debug output for production
    # print("=== DEBUG: All lines ===")
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Check if we've found the table header
        if 'Article' in line and 'Product description' in line and 'COO' in line:
            in_table = True
            header_found = True
            i += 1
            continue
            
        # Skip lines that are clearly not part of the product table
        if (not header_found or 
            '---' in line or
            'www.dsl-global.nl' in line or
            'Page:' in line or
            line.startswith('--- PAGE') or
            'Total excluding VAT' in line or
            'VAT EU' in line or
            'BTW omzet' in line or
            'Totaal te voldoen' in line or
            'The exporter of' in line or
            'Payment condition' in line):
            i += 1
            continue
            
        # Look for product lines that start with an article number (EAN code) or alphanumeric SKU
        # The format is: ARTICLE_NUMBER/SKU DESCRIPTION QUANTITY И UNIT_PRICE 0% И NET_TOTAL
        # Skip shipping costs - they should not be treated as product items
        if 'Shipping costs' in line or 'shipping' in line.lower():
            i += 1
            continue
            
        # First try to match 13+ digit EAN codes
        article_match = re.search(r'^(\d{13,})', line)
        if not article_match:
            # If no EAN code, try to match alphanumeric SKU codes (like "Per4m ISO 2kg")
            # Look for patterns that start with letters/numbers and contain spaces, followed by price info
            article_match = re.search(r'^([A-Za-z0-9][A-Za-z0-9\s]+?)(?=\s+\d+\s+€)', line)
        if article_match and in_table:
            # This is a product line
            article = article_match.group(1)
            
            # Try to extract quantity, unit price, and total from the same line using € as currency symbol
            qty_price_match = re.search(r'(\d+)\s+€\s*([\d.,]+)\s+0%\s+€\s*([\d.,]+)', line)
            
            if qty_price_match:
                quantity = qty_price_match.group(1)
                unit_price = qty_price_match.group(2).replace(',', '.')
                net_total_str = qty_price_match.group(3)
                
                # Handle large numbers with periods as thousands separators (like 2.100,48)
                if '.' in net_total_str and ',' in net_total_str:
                    # Format like 2.100,48 - thousands separator with comma decimal
                    net_total = net_total_str.replace('.', '').replace(',', '.')
                elif '.' in net_total_str and net_total_str.count('.') == 1:
                    parts = net_total_str.split('.')
                    if len(parts[1]) == 2:
                        # This is a normal decimal like 43.76
                        net_total = net_total_str
                    elif len(parts[1]) == 3:
                        # This might be thousands separator like 2.100
                        # But if there's more text after, it might be 2.100,48
                        net_total = net_total_str
                else:
                    net_total = net_total_str.replace(',', '.')
                
                # Extract description between article number and quantity
                desc_start = article_match.end()
                desc_end = qty_price_match.start()
                description = line[desc_start:desc_end].strip()
                
                # For alphanumeric SKUs like "Per4m ISO 2kg", handle them specially
                if not description or len(description) < 5:
                    # Check if this is a product name that should be the SKU
                    if 'Per4m' in article or 'ISO' in article:
                        # This is a product name, use it as the SKU and look for additional description
                        # The description will be built from continuation lines
                        description = ""  # Start with empty description, will be built from continuation lines
                
                # Look ahead for continuation lines of description
                j = i + 1
                while j < len(lines):
                    next_line = lines[j].strip()
                    
                    # Stop if we hit another product, total, or page boundary
                    if (re.match(r'\d{13,}', next_line) or 
                        'Total excluding VAT' in next_line or 
                        'VAT EU' in next_line or
                        'BTW omzet' in next_line or
                        'Totaal te voldoen' in next_line or
                        next_line.startswith('--- PAGE') or
                        'www.dsl-global.nl' in next_line or
                        'The exporter of' in next_line or
                        'Payment condition' in next_line):
                        break
                    
                    # If this line doesn't contain price information, it's likely description continuation
                    if not re.search(r'€\s*[\d.,]+', next_line):
                        description += ' ' + next_line
                        j += 1
                    else:
                        break
                
                # Clean up description to remove duplication with SKU
                if article in description:
                    description = description.replace(article, "").strip()
                    # Remove extra spaces
                    description = re.sub(r'\s+', ' ', description).strip()
                
                # Special handling for "Per4m ISO 2kg" - remove the duplicate part
                if article == "Per4m ISO 2kg" and "Per4m ISO 2kg" in description:
                    # Remove the duplicate "Per4m ISO 2kg" from the beginning of description
                    description = description.replace("Per4m ISO 2kg", "").strip()
                    # Remove extra spaces
                    description = re.sub(r'\s+', ' ', description).strip()
                
                # Clean up description to remove date patterns and other unwanted text
                # Remove date patterns like "10 april 2025", "10 apr 2025", etc.
                description = re.sub(r'\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\b', '', description, flags=re.IGNORECASE)
                # Remove extra spaces after cleanup
                description = re.sub(r'\s+', ' ', description).strip()
                
                # Add to order items if we have all required data
                if quantity and unit_price and net_total:
                    invoice_data['order_items'].append({
                        'article': article,
                        'description': description.strip(),
                        'quantity': quantity,
                        'unit_price': unit_price,
                        'net_total': net_total
                    })
                
                i = j  # Skip the lines we've processed
                continue
            else:
                # Handle special cases where the line doesn't have the standard format
                # Extract description and look for price info on next lines
                description_start = article_match.end()
                description = line[description_start:].strip()
                
                # Look ahead for quantity/price information
                j = i + 1
                quantity = None
                unit_price = None
                net_total = None
                
                while j < len(lines):
                    next_line = lines[j].strip()
                    
                    # Stop if we hit another product or boundary
                    if (re.match(r'\d{13,}', next_line) or 
                        'Total excluding VAT' in next_line or 
                        next_line.startswith('--- PAGE')):
                        break
                    
                    # Look for price information in next line
                    qty_price_match = re.search(r'(\d+)\s+€\s*([\d.,]+)\s+0%\s+€\s*([\d.,]+)', next_line)
                    if qty_price_match:
                        quantity = qty_price_match.group(1)
                        unit_price = qty_price_match.group(2).replace(',', '.')
                        net_total = qty_price_match.group(3).replace(',', '.')
                        j += 1
                        break
                    
                    # Add to description if no price info
                    if not re.search(r'€\s*[\d.,]+', next_line):
                        description += ' ' + next_line
                    
                    j += 1
                
                # Add to order items if we found price info
                if quantity and unit_price and net_total:
                    invoice_data['order_items'].append({
                        'article': article,
                        'description': description.strip(),
                        'quantity': quantity,
                        'unit_price': unit_price,
                        'net_total': net_total
                    })
                
                i = j  # Skip the lines we've processed
                continue
        
        # Handle shipping costs separately - don't add as line item
        if in_table and ('Shipping costs' in line or 'shipping' in line.lower()):
            # Extract shipping cost and store in totals
            # Preferred format with explicit quantity/unit/total
            qty_price_match = re.search(r'(\d+)\s+€\s*([\d.,]+)\s+0%\s+€\s*([\d.,]+)', line)
            shipping_cost = None
            if qty_price_match:
                shipping_cost = qty_price_match.group(3)
            else:
                # Fallbacks:
                # 1) Look for an explicit euro value after the last € on the line
                euro_val_match = re.search(r'€\s*([\d\s.,]+)(?!.*€)', line)
                if euro_val_match:
                    shipping_cost = euro_val_match.group(1)
                else:
                    # 2) Take the last numeric token on the line (supports 215 or 2.100,48)
                    last_num_match = re.search(r'([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+)\s*$', line)
                    if last_num_match:
                        shipping_cost = last_num_match.group(1)

            if shipping_cost is not None:
                # Normalize number: remove thousands separators and fix decimal
                normalized = shipping_cost.replace(' ', '')
                if '.' in normalized and ',' in normalized:
                    # Likely thousands with decimal comma: 2.100,48 -> 2100.48
                    normalized = normalized.replace('.', '').replace(',', '.')
                else:
                    # Replace decimal comma with dot if present
                    normalized = normalized.replace(',', '.')
                invoice_data['totals']['shipping_fee'] = normalized
                # Don't add to order_items - this will be handled as shipping fee
        
        # Handle the special "Per4m ISO 2kg" line that has no article number
        # This is now handled by the general alphanumeric SKU logic above, but keep this as fallback
        if in_table and line.startswith('Per4m ISO 2kg') and not article_match:
            qty_price_match = re.search(r'(\d+)\s+€\s*([\d.,]+)\s+0%\s+€\s*([\d.,]+)', line)
            if qty_price_match:
                quantity = qty_price_match.group(1)
                unit_price = qty_price_match.group(2).replace(',', '.')
                net_total_str = qty_price_match.group(3)
                
                # Handle thousands separator
                if '.' in net_total_str and net_total_str.count('.') >= 1:
                    # Check for format like 2.100,48
                    if ',' in net_total_str:
                        net_total = net_total_str.replace('.', '').replace(',', '.')
                    else:
                        net_total = net_total_str
                else:
                    net_total = net_total_str.replace(',', '.')
                
                # Extract description
                desc_end = qty_price_match.start()
                description = line[:desc_end].strip()
                
                invoice_data['order_items'].append({
                    'article': 'Per4m ISO 2kg',  # Use the product name as SKU
                    'description': description,
                    'quantity': quantity,
                    'unit_price': unit_price,
                    'net_total': net_total
                })
        
        i += 1

    # If shipping fee wasn't captured in the table, try global text search
    if 'shipping_fee' not in invoice_data['totals']:
        def parse_euro_amount(val: str) -> str:
            v = (val or '').strip()
            v = v.replace(' ', '')
            # Pattern: 1.234,56 or 1,234.56 or 215,00 or 215.00 or 215
            m = re.match(r'^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{2}))?$', v)
            if m:
                whole = re.sub(r'[.,]', '', m.group(1))
                cents = m.group(2) or '00'
                return f"{int(whole)}.{cents}"
            # Fallback: digits only
            if re.match(r'^\d+$', v):
                # If the original string looked like it had cents (ends with 00 from formats), keep as integer euros
                return f"{int(v)}.00"
            # Last resort: replace comma with dot and try float
            try:
                return f"{float(v.replace(',', '.')):.2f}"
            except Exception:
                return '0.00'
        # Look for "Shipping costs" followed by an amount on the same or next line
        shipping_patterns = [
            r"Shipping costs[^\n]*?€\s*([\d\s.,]+)",
            r"Shipping costs[^\n]*?([\d\s.,]+)\s*€",
            r"Shipping costs\s*\n\s*€\s*([\d\s.,]+)",
            r"Shipping costs\s*\n\s*([\d\s.,]+)\s*€",
            r"Shipping costs[^\n]*?([\d\s.,]+)\b"
        ]
        for pat in shipping_patterns:
            m = re.search(pat, text, flags=re.IGNORECASE)
            if m:
                val = m.group(1)
                normalized = parse_euro_amount(val)
                invoice_data['totals']['shipping_fee'] = normalized
                break

    # Extract totals
    total_match = re.search(r'Total excluding VAT\s+€\s*([\d.,]+)', text)
    if total_match:
        invoice_data['totals']['excl_vat'] = total_match.group(1).replace(',', '.')
    
    total_match = re.search(r'Total te voldoen\s+€\s*([\d.,]+)', text)
    if total_match:
        invoice_data['totals']['total'] = total_match.group(1).replace(',', '.')
    
    # Extract payment terms
    payment_match = re.search(r'Payment condition:\s*(.+?)(?=\n|$)', text)
    if payment_match:
        invoice_data['metadata']['payment_terms'] = payment_match.group(1).strip()

    return invoice_data

if __name__ == "__main__":
    args = sys.argv[1:]
    pdf_path = "DSL Global.pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    try:
        data = extract_dsl_invoice_data(pdf_path)
        if json_flag:
            print(json.dumps(data, ensure_ascii=True))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        if json_flag:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}")