from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

def extract_io_genix_invoice_data(pdf_path):
    """Extract data from Io genix invoices"""
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

    return parse_io_genix_invoice_text(full_text)

def parse_io_genix_invoice_text(text: str):
    """Parse Io genix invoice text with specialized logic for their format"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Extract vendor information
    vendor_match = re.search(r'(IO GENIX|Io genix|IOGENIX)', text, re.IGNORECASE)
    if vendor_match:
        invoice_data['vendor']['name'] = 'Io genix'

    # Extract customer information - look for company name patterns
    customer_match = re.search(r'(CUSTOMER|CLIENT|COMPANY|NAME)', text, re.IGNORECASE)
    if customer_match:
        invoice_data['customer']['name'] = customer_match.group(1)

    # Extract invoice metadata
    invoice_num_match = re.search(r'(?:Invoice|Facture|N°|No\.?)\s*:?\s*(\w+)', text, re.IGNORECASE)
    if invoice_num_match:
        invoice_data['metadata']['invoice_number'] = invoice_num_match.group(1)

    # Extract date - look for common date formats
    date_match = re.search(r'(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})', text)
    if date_match:
        date_str = date_match.group(1)
        print(f"DEBUG: Found date match: '{date_str}'", file=sys.stderr)
        # Convert date to ISO format for better JavaScript compatibility
        try:
            # Handle different date separators and convert to ISO format
            if '/' in date_str:
                parts = date_str.split('/')
            elif '-' in date_str:
                parts = date_str.split('-')
            elif '.' in date_str:
                parts = date_str.split('.')
            else:
                parts = [date_str]
            
            if len(parts) == 3:
                day, month, year = parts
                # Ensure proper formatting (DD/MM/YYYY is common in European invoices)
                if len(day) == 1:
                    day = '0' + day
                if len(month) == 1:
                    month = '0' + month
                if len(year) == 2:
                    year = '20' + year
                
                # Format as ISO date string (YYYY-MM-DD)
                iso_date = f"{year}-{month}-{day}"
                invoice_data['metadata']['invoice_date'] = iso_date
                print(f"DEBUG: Converted date '{date_str}' to ISO format '{iso_date}'", file=sys.stderr)
            else:
                invoice_data['metadata']['invoice_date'] = date_str
                print(f"DEBUG: Could not parse date format '{date_str}', using as-is", file=sys.stderr)
        except Exception as e:
            print(f"DEBUG: Error parsing date '{date_str}': {e}", file=sys.stderr)
            invoice_data['metadata']['invoice_date'] = date_str
    else:
        print(f"DEBUG: No date found in text", file=sys.stderr)

    # Extract order items - Io genix specific format
    # Columns: REFERENCE | DESCRIPTION | QUANTITY | PRICE | TOTAL
    lines = text.split('\n')
    i = 0
    in_table = False
    header_found = False
    
    # Debug: Print total lines for troubleshooting
    print(f"DEBUG: Processing {len(lines)} lines of text", file=sys.stderr)
    
    # Debug: Print first 30 lines to see the structure
    print(f"DEBUG: First 30 lines:", file=sys.stderr)
    for idx, line in enumerate(lines[:30]):
        print(f"DEBUG: Line {idx}: '{line}'", file=sys.stderr)
    
    # Look for the specific Io genix table header pattern
    # The header appears to be: "REFERENCE DESCRIPTION Quantity Dcnt. TOTAL"
    for idx, line in enumerate(lines):
        if 'REFERENCE' in line and 'DESCRIPTION' in line and 'Quantity' in line and 'TOTAL' in line:
            print(f"DEBUG: Found Io genix table header at line {idx}: '{line}'", file=sys.stderr)
            header_found = True
            in_table = True
            break
    
    # Helper function to parse decimal numbers
    def parse_number(s: str) -> float:
        if not s:
            return 0.0
        # Clean the string and handle decimal format
        original_s = s
        s = s.replace('€', '').replace('EUR', '').strip()
        s = re.sub(r'[^\d,.-]', '', s)
        
        print(f"DEBUG: parse_number input: '{original_s}' -> cleaned: '{s}'", file=sys.stderr)
        
        # Handle various decimal formats
        if ',' in s and '.' in s:
            # For European format like "1.438,40" (thousands separator + decimal separator)
            # The key insight: if comma is followed by exactly 2 digits, it's a decimal separator
            # If comma is followed by more than 2 digits, it's a thousands separator
            
            # Find the last comma position
            comma_pos = s.rfind(',')
            if comma_pos != -1:
                # Check what comes after the comma
                after_comma = s[comma_pos + 1:]
                print(f"DEBUG: Found comma at pos {comma_pos}, after_comma: '{after_comma}'", file=sys.stderr)
                if len(after_comma) == 2 and after_comma.isdigit():
                    # This is European format: "1.438,40" -> "1438.40"
                    s = s.replace('.', '').replace(',', '.')
                    print(f"DEBUG: European format detected, converted to: '{s}'", file=sys.stderr)
                else:
                    # This might be US format: "1,234.56" -> "1234.56"
                    s = s.replace(',', '')
                    print(f"DEBUG: US format detected, converted to: '{s}'", file=sys.stderr)
        elif ',' in s:
            # Check if it's a decimal separator (,XX) or thousands separator
            parts = s.split(',')
            if len(parts) == 2 and len(parts[1]) <= 2:
                # Decimal separator
                s = s.replace(',', '.')
                print(f"DEBUG: Decimal separator detected, converted to: '{s}'", file=sys.stderr)
            else:
                # Thousands separator
                s = s.replace(',', '')
                print(f"DEBUG: Thousands separator detected, converted to: '{s}'", file=sys.stderr)
        
        print(f"DEBUG: Final string before float conversion: '{s}'", file=sys.stderr)
        try:
            result = float(s)
            print(f"DEBUG: parse_number result: {result}", file=sys.stderr)
            return result
        except ValueError:
            print(f"DEBUG: parse_number error converting '{s}' to float", file=sys.stderr)
            return 0.0

    while i < len(lines):
        line = lines[i].strip()
        
        # Skip lines that are clearly not part of the product table
        if (not header_found or 
            '---' in line or
            'www.' in line.lower() or
            'page:' in line.lower() or
            line.startswith('--- PAGE') or
            'total' in line.lower() and ('ht' in line.lower() or 'vat' in line.lower()) or
            'subtotal' in line.lower() or
            'tva' in line.lower() or
            'ttc' in line.lower() or
            'net' in line.lower() or
            'gross' in line.lower() or
            'taxable' in line.lower() or
            'pag ' in line.lower()):
            # Check for totals before skipping
            if 'total' in line.lower() or 'subtotal' in line.lower():
                # Look for patterns like "Total: 123.45" or "Subtotal: 123.45"
                total_match = re.search(r'([\d\s.,]+)\s*€?', line)
                if total_match:
                    total_str = total_match.group(1).strip()
                    total_val = parse_number(total_str)
                    if total_val > 0:
                        if 'subtotal' in line.lower() or 'ht' in line.lower() or 'net' in line.lower():
                            invoice_data['totals']['subtotal'] = str(total_val)
                        elif 'total' in line.lower():
                            invoice_data['totals']['total'] = str(total_val)
            i += 1
            continue
            
        # Look for product lines in table
        if in_table and line:
            # Try to extract product information using regex patterns
            # Pattern for Io genix format: REFERENCE DESCRIPTION QUANTITY PRICE TOTAL
            
            # Look for lines that start with a reference (SKU) - could be alphanumeric
            ref_match = re.match(r'^([A-Z0-9\-_]+)', line)
            if ref_match:
                reference = ref_match.group(1)
                
                # Skip if reference is too short or looks like a header
                if len(reference) < 2 or reference.lower() in ['reference', 'ref', 'sku']:
                    i += 1
                    continue
                
                # Also look for SKU codes that might be embedded in the line (not just at start)
                # This helps catch items where the SKU might not be at the very beginning
                if len(reference) < 3:  # If the reference at start is too short
                    # Look for longer SKU patterns in the line
                    sku_patterns = re.findall(r'\b([A-Z]{2,}[0-9A-Z\-_]*)', line)
                    if sku_patterns:
                        # Use the longest SKU pattern found
                        reference = max(sku_patterns, key=len)
                        print(f"DEBUG: Found embedded SKU: {reference} in line: {line}", file=sys.stderr)
            else:
                # If no SKU at start, look for SKU patterns anywhere in the line
                # This catches items where the SKU is embedded in the description
                sku_patterns = re.findall(r'\b([A-Z]{2,}[0-9A-Z\-_]*)', line)
                if sku_patterns and len(line.strip()) > 10:  # Only if line has substantial content
                    # Use the longest SKU pattern found
                    reference = max(sku_patterns, key=len)
                    print(f"DEBUG: Found embedded SKU in middle of line: {reference} in line: {line}", file=sys.stderr)
                else:
                    i += 1
                    continue
            
            print(f"DEBUG: Processing line with reference: {reference}", file=sys.stderr)
            
            # Extract the rest of the line for parsing
            remaining_line = line[len(reference):].strip()
            
            # If the line seems incomplete, look at next lines
            if not re.search(r'\d+[.,]\d{2}\s*$', remaining_line):
                # Look ahead for completion
                for k in range(i + 1, min(i + 3, len(lines))):
                    next_line = lines[k].strip()
                    if (re.match(r'^[A-Z0-9\-_]+', next_line) or  # Next product
                        not next_line or
                        'total' in next_line.lower() or
                        'caducidad' in next_line.lower() or
                        'lote' in next_line.lower()):
                        break
                    remaining_line += ' ' + next_line
            
            # Parse the Io genix format: DESCRIPTION QUANTITY PRICE TOTAL
            # Look for the pattern: QUANTITY PRICE TOTAL anywhere in the line
            # This is more flexible than requiring it at the end
            # Updated to handle totals with more than 2 decimal places (e.g., 1.438,40)
            # Also made quantity pattern more flexible to handle larger quantities (e.g., 100)
            # The key insight: European format like "1.438,40" needs special handling
            # Look for: QUANTITY PRICE TOTAL where TOTAL can be European format (1.438,40)
            pattern_match = re.search(r'(\b\d{1,3}\b)\s+(\d+[.,]\d{2})\s+(\d+[.,]\d{2,3}(?:,\d{2})?)', remaining_line)
            
            # Debug: Print the line content and what we're looking for
            print(f"DEBUG: Line content: '{remaining_line}'", file=sys.stderr)
            
            # Also look for alternative patterns that might be missed
            # Some lines might have different formatting
            alt_pattern_match = re.search(r'(\b\d{1,2}\b)\s+(\d+[.,]\d{2})\s+(\d+[.,]\d+)', remaining_line)
            
            # Look for items with 100% discount (no total price) - these are important!
            # Pattern: QUANTITY PRICE (no total, or total = 0.00, or 100%)
            discount_pattern = re.search(r'(\b\d{1,3}\b)\s+(\d+[.,]\d{2})(?:\s+(?:0\.00|100%))?$', remaining_line)
            
            if not alt_pattern_match and not discount_pattern:
                # Try to find any three numbers that could be quantity, price, total
                numbers = re.findall(r'\b(\d+[.,]?\d*)\b', remaining_line)
                if len(numbers) >= 3:
                    print(f"DEBUG: Found numbers: {numbers}", file=sys.stderr)
            
            # Handle both regular items and discounted items
            if pattern_match or discount_pattern:
                try:
                    # Handle both regular items and discounted items
                    if pattern_match:
                        # Regular item: QUANTITY PRICE TOTAL
                        quantity = int(pattern_match.group(1))
                        unit_price = parse_number(pattern_match.group(2))
                        total = parse_number(pattern_match.group(3))
                    else:
                        # Discounted item: QUANTITY PRICE (no total or total = 0.00)
                        quantity = int(discount_pattern.group(1))
                        unit_price = parse_number(discount_pattern.group(2))
                        total = 0.00  # 100% discount
                        print(f"DEBUG: Found discounted item - Qty: {quantity}, Price: {unit_price}, Total: 0.00 (100% discount)", file=sys.stderr)
                    
                    # Extract description up to the quantity pattern
                    if pattern_match:
                        desc_end = pattern_match.start()
                    else:
                        desc_end = discount_pattern.start()
                    description = remaining_line[:desc_end].strip()
                    
                    # Clean up description
                    description = re.sub(r'\s+', ' ', description).strip()
                    
                    # Enhanced multi-line description extraction
                    # Look back for description continuation (previous lines)
                    for k in range(i-1, max(i-5, -1), -1):
                        prev_line = lines[k].strip()
                        # Stop if we hit another product line or header
                        if (re.match(r'^[A-Z0-9\-_]+', prev_line) or  # Previous product
                            not prev_line or
                            'reference' in prev_line.lower() or
                            'description' in prev_line.lower() or
                            'quantity' in prev_line.lower() or
                            'total' in prev_line.lower()):
                            break
                        # Add to description (prepend since we're going backwards)
                        if description:
                            description = prev_line + ' ' + description
                        else:
                            description = prev_line
                    
                    # Look ahead for description continuation (next lines)
                    # Continue until we hit a new SKU or end of table
                    for k in range(i + 1, len(lines)):
                        next_line = lines[k].strip()
                        
                        # Stop if we hit a new product line (starts with SKU)
                        if re.match(r'^[A-Z0-9\-_]+', next_line):
                            # Check if this looks like a real SKU (not just a number)
                            potential_sku = re.match(r'^([A-Z0-9\-_]+)', next_line).group(1)
                            # More precise SKU detection - look for Io genix specific patterns
                            if (len(potential_sku) >= 4 and  # Io genix SKUs are typically 4+ characters
                                not potential_sku.isdigit() and
                                potential_sku.lower() not in ['reference', 'ref', 'sku', 'genix', 'geni', 'io'] and
                                # Io genix SKUs typically start with IG, IGW, IGI, etc.
                                (potential_sku.startswith('IG') or 
                                 potential_sku.startswith('IGW') or 
                                 potential_sku.startswith('IGI') or
                                 potential_sku.startswith('IGZ') or
                                 potential_sku.startswith('IGT') or
                                 potential_sku.startswith('IGC') or
                                 potential_sku.startswith('IGM') or
                                 potential_sku.startswith('IGV') or
                                 potential_sku.startswith('IGD') or
                                 potential_sku.startswith('IGH') or
                                 potential_sku.startswith('IGR') or
                                 potential_sku.startswith('IGP'))):
                                print(f"DEBUG: Stopping description at new SKU: {potential_sku}", file=sys.stderr)
                                break
                        
                        # Stop if we hit table end markers
                        if (not next_line or
                             'total' in next_line.lower() and ('ht' in next_line.lower() or 'vat' in next_line.lower()) or
                             'subtotal' in next_line.lower() or
                             'tva' in next_line.lower() or
                             'ttc' in next_line.lower() or
                             'net' in next_line.lower() or
                             'gross' in next_line.lower() or
                             'taxable' in next_line.lower() or
                             'pag ' in next_line.lower() or
                             '---' in next_line or
                             # Additional footer text patterns for Io genix invoices
                             'important note' in next_line.lower() or
                             'no claims' in next_line.lower() or
                             'discount vat' in next_line.lower() or
                             'additional vat' in next_line.lower() or
                             'terms' in next_line.lower() or
                             'conditions' in next_line.lower() or
                             'payment' in next_line.lower() or
                             'delivery' in next_line.lower() or
                             'www.' in next_line.lower() or
                             'email:' in next_line.lower() or
                             'tel:' in next_line.lower() or
                             'fax:' in next_line.lower()):
                             print(f"DEBUG: Stopping description at table end marker: '{next_line}'", file=sys.stderr)
                             break
                        
                        # Add this line to description
                        description += ' ' + next_line
                        print(f"DEBUG: Added to description: '{next_line}'", file=sys.stderr)
                    
                    # Final cleanup
                    description = re.sub(r'\s+', ' ', description).strip()
                    
                    print(f"DEBUG: Parsed - Qty: {quantity}, Price: {unit_price}, Total: {total}", file=sys.stderr)
                    
                    # Validate the data makes sense - add better validation
                    # Allow items with total = 0 (100% discount) as these are important
                    if (unit_price > 0 and quantity > 0 and total >= 0 and reference and
                        len(reference) >= 3 and  # Skip very short references
                        not reference.isdigit() and  # Skip pure numeric references like "16"
                        quantity < 1000 and  # Reasonable quantity range
                        unit_price < 10000 and  # Reasonable price range
                        total < 100000):  # Reasonable total range
                        
                        # Check for duplicates based on reference + quantity + total
                        existing_items = [(item['reference'], item['quantity'], item['total']) for item in invoice_data['order_items']]
                        current_item = (reference, str(int(quantity)), f"{total:.2f}")
                        
                        if current_item not in existing_items:
                            invoice_data['order_items'].append({
                                'reference': reference,
                                'description': description,
                                'quantity': str(int(quantity)),
                                'unit_price': f"{unit_price:.2f}",
                                'total': f"{total:.2f}"
                            })
                            print(f"DEBUG: Found item - Ref: {reference}, Qty: {quantity}, Price: {unit_price}, Total: {total}", file=sys.stderr)
                    else:
                        print(f"DEBUG: Skipping invalid item - Ref: {reference}, Qty: {quantity}, Price: {unit_price}, Total: {total}", file=sys.stderr)
                    
                except (IndexError, ValueError) as e:
                    print(f"DEBUG: Error parsing line '{line}': {e}", file=sys.stderr)
                    continue
        
        i += 1

    # Calculate totals from line items if not found in table processing
    if invoice_data['order_items']:
        subtotal = sum(parse_number(item['total']) for item in invoice_data['order_items'])
        if not invoice_data['totals'].get('subtotal'):
            invoice_data['totals']['subtotal'] = f"{subtotal:.2f}"
        if not invoice_data['totals'].get('total'):
            invoice_data['totals']['total'] = f"{subtotal:.2f}"

    # Debug: Print final results
    print(f"DEBUG: Final result - {len(invoice_data['order_items'])} items found", file=sys.stderr)
    if invoice_data['order_items']:
        print(f"DEBUG: Sample items: {invoice_data['order_items'][:2]}", file=sys.stderr)

    return invoice_data

if __name__ == "__main__":
    args = sys.argv[1:]
    pdf_path = "Io genix (1).pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    try:
        data = extract_io_genix_invoice_data(pdf_path)
        
        # Ensure clean output for JSON mode
        if json_flag:
            # Clean the data to ensure valid JSON
            if data.get('order_items'):
                # Ensure all required fields are present and clean
                for item in data['order_items']:
                    if 'reference' not in item or not item['reference']:
                        item['reference'] = f"ITEM_{len(data['order_items'])}"
                    if 'description' not in item:
                        item['description'] = ""
                    if 'quantity' not in item:
                        item['quantity'] = "0"
                    if 'unit_price' not in item:
                        item['unit_price'] = "0.00"
                    if 'total' not in item:
                        item['total'] = "0.00"
            
            # Ensure vendor name is set
            if not data.get('vendor') or not data['vendor'].get('name'):
                data['vendor'] = {'name': 'Io genix'}
            
            # Ensure totals are present
            if not data.get('totals'):
                data['totals'] = {}
            if not data.get('metadata'):
                data['metadata'] = {}
            
            # Output clean JSON without any extra text - use ensure_ascii=True for Windows compatibility
            json_output = json.dumps(data, ensure_ascii=True, separators=(',', ':'))
            print(f"DEBUG: Final JSON output - invoice_date: {data.get('metadata', {}).get('invoice_date', 'NOT_FOUND')}", file=sys.stderr)
            print(json_output)
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        error_data = {"error": str(e)}
        if json_flag:
            print(json.dumps(error_data, ensure_ascii=False))
        else:
            print(f"Error: {e}")
