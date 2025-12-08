from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

def extract_life_pro_invoice_data(pdf_path):
    """Extract data from Life pro invoices"""
    print(f"DEBUG: extract_life_pro_invoice_data called with path: {pdf_path}", file=sys.stderr)
    
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    print(f"DEBUG: Starting PDF text extraction...", file=sys.stderr)
    # Extract text with positioning information
    full_text = ""
    try:
        page_count = 0
        for page_num, page_layout in enumerate(extract_pages(pdf_path)):
            page_count += 1
            print(f"DEBUG: Processing page {page_num + 1}", file=sys.stderr)
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
        
        print(f"DEBUG: Extracted text from {page_count} pages, total length: {len(full_text)}", file=sys.stderr)
    except Exception as e:
        print(f"ERROR: Failed to extract PDF text: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        raise

    print(f"DEBUG: Starting parse_life_pro_invoice_text...", file=sys.stderr)
    return parse_life_pro_invoice_text(full_text)

def parse_life_pro_invoice_text(text: str):
    """Parse Life pro invoice text with specialized logic for their format"""
    print(f"DEBUG: parse_life_pro_invoice_text called, text length: {len(text)}", file=sys.stderr)
    
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    print(f"DEBUG: Starting vendor extraction...", file=sys.stderr)
    # Extract vendor information
    vendor_match = re.search(r'(LIFE PRO|Life Pro)', text, re.IGNORECASE)
    if vendor_match:
        invoice_data['vendor']['name'] = 'Life Pro'

    # Extract customer information - look for company name patterns
    customer_match = re.search(r'(FITNESS WORLD NUTRITION|FWN)', text, re.IGNORECASE)
    if customer_match:
        invoice_data['customer']['name'] = customer_match.group(1)

    # Extract invoice metadata
    invoice_num_match = re.search(r'(?:Facture|Invoice|N°).*?(\d{4,})', text, re.IGNORECASE)
    if invoice_num_match:
        invoice_data['metadata']['invoice_number'] = invoice_num_match.group(1)

    # Extract date
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

    # Extract order items - Life pro specific format
    # Look for table with columns: REF EAN | Description | Units | Price | Col4 | Amount
    lines = text.split('\n')
    i = 0
    in_table = False
    header_found = False
    
    # Debug: Print total lines for troubleshooting
    print(f"DEBUG: Processing {len(lines)} lines of text", file=sys.stderr)
    
    # Helper function to parse decimal numbers
    def parse_number(s: str, number_type: str = "unknown") -> float:
        if not s:
            return 0.0
        # Clean the string and handle decimal format
        original_s = s
        s = s.replace('€', '').replace('EUR', '').strip()
        s = re.sub(r'[^\d,.-]', '', s)
        
        print(f"DEBUG: parse_number input: '{original_s}' -> cleaned: '{s}'", file=sys.stderr)
        
        # Handle various decimal formats
        if ',' in s and '.' in s:
            # For European format like "1.352,00" (thousands separator + decimal separator)
            # The key insight: if comma is followed by exactly 2 digits, it's a decimal separator
            # The period is a thousands separator
            
            # Find the last comma position
            comma_pos = s.rfind(',')
            if comma_pos != -1:
                # Check what comes after the comma
                after_comma = s[comma_pos + 1:]
                print(f"DEBUG: Found comma at pos {comma_pos}, after_comma: '{after_comma}'", file=sys.stderr)
                if len(after_comma) == 2 and after_comma.isdigit():
                    # This is European format: "1.352,00" -> "1352.00"
                    s = s.replace('.', '').replace(',', '.')
                    print(f"DEBUG: European format (both separators) detected, converted to: '{s}'", file=sys.stderr)
                else:
                    # This might be US format: "1,234.56" -> "1234.56"
                    s = s.replace(',', '')
                    print(f"DEBUG: US format detected, converted to: '{s}'", file=sys.stderr)
        elif ',' in s:
            # Only comma present - check if it's a decimal separator (,XX) or thousands separator
            parts = s.split(',')
            if len(parts) == 2 and len(parts[1]) == 2 and parts[1].isdigit():
                # Decimal separator: "352,00" -> "352.00" OR "1352,00" -> "1352.00"
                # This handles European decimal format correctly
                s = s.replace(',', '.')
                print(f"DEBUG: European decimal separator detected, converted to: '{s}'", file=sys.stderr)
            elif len(parts) == 2 and len(parts[1]) > 2:
                # Thousands separator: "1,234" -> "1234"
                s = s.replace(',', '')
                print(f"DEBUG: Thousands separator detected, converted to: '{s}'", file=sys.stderr)
            else:
                # Default: treat comma as decimal separator
                s = s.replace(',', '.')
                print(f"DEBUG: Comma treated as decimal separator, converted to: '{s}'", file=sys.stderr)
        elif '.' in s:
            # Only period present
            parts = s.split('.')
            if len(parts) == 2 and len(parts[1]) == 2 and parts[1].isdigit():
                # Already decimal format: "352.00" -> keep as is
                print(f"DEBUG: US decimal format detected, keeping: '{s}'", file=sys.stderr)
            else:
                # Might be thousands separator, but keep as is for now
                print(f"DEBUG: Period format, keeping: '{s}'", file=sys.stderr)
        
        print(f"DEBUG: Final string before float conversion: '{s}'", file=sys.stderr)
        try:
            result = float(s)
            print(f"DEBUG: parse_number result: {result}", file=sys.stderr)
            return result
        except ValueError:
            print(f"DEBUG: parse_number error converting '{s}' to float", file=sys.stderr)
            return 0.0

    # Add safety counter to prevent infinite loops
    iterations = 0
    max_iterations = len(lines) * 2  # Allow up to 2x the number of lines as iterations
    
    while i < len(lines) and iterations < max_iterations:
        iterations += 1
        line = lines[i].strip()
        
        # Look for table header indicators
        if ('ref ean' in line.lower() and 'description' in line.lower()) or \
           ('units' in line.lower() and ('price' in line.lower() or 'amount' in line.lower())):
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
            'LOT:' in line or
            'EXP:' in line or
            'inscrita en el registro' in line.lower() or
            'origin of the merchandise' in line.lower() or
            'indiex sport nutrition' in line.lower() or
            'gross amount' in line.lower() or
            'discounts' in line.lower() or
            'operación intracomunitaria' in line.lower() or
            'total' in line.lower() and ('ht' in line.lower() or 'vat' in line.lower()) or
            'subtotal' in line.lower() or
            'tva' in line.lower() or
            'ttc' in line.lower()):
            # Check for totals before skipping
            if 'total' in line.lower() or 'subtotal' in line.lower():
                # Look for patterns like "Total: 123.45" or "Subtotal: 123.45"
                total_match = re.search(r'([\d\s.,]+)\s*€?', line)
                if total_match:
                    total_str = total_match.group(1).strip()
                    total_val = parse_number(total_str)
                    if total_val > 0:
                        if 'subtotal' in line.lower() or 'ht' in line.lower():
                            invoice_data['totals']['subtotal'] = str(total_val)
                        elif 'total' in line.lower():
                            invoice_data['totals']['total'] = str(total_val)
            i += 1
            continue
            
        # Look for product lines in table
        if in_table and line:
            # Skip discount lines (lines with " - Promoción")
            if " - Promoción" in line:
                print(f"DEBUG: Skipping discount line: '{line}'", file=sys.stderr)
                i += 1
                continue
                
            # Try to extract product information using regex patterns
            # Pattern for Life pro format: REF_EAN | DESCRIPTION | UNITS | PRICE | COL4 | AMOUNT
            
            # Look for lines with EAN codes (13 digits) or other product references
            # Some items might have shorter codes or different formats
            ref_match = re.match(r'^(\d{8,15}|[A-Z]+)', line)
            if (ref_match and 
                len(ref_match.group(1)) >= 4 and 
                ref_match.group(1) not in ['MAYORISTAS', 'CHARGE'] and
                not line.startswith('LOT:') and not line.startswith('EXP:')):
                reference = ref_match.group(1)
                
                # Extract the rest of the line for parsing, including next lines if needed
                remaining_line = line[len(reference):].strip()
                
                # If the line seems incomplete (no decimal at the end), look at next lines
                if not re.search(r'\d+,\d{2}\s*$', remaining_line):
                    # Look ahead for completion
                    for k in range(i + 1, min(i + 3, len(lines))):
                        next_line = lines[k].strip()
                        if ('LOT:' in next_line or 'EXP:' in next_line or 
                            re.match(r'^\d{8,15}', next_line) or
                            not next_line):
                            break
                        remaining_line += ' ' + next_line
                
                # Parse the Life Pro format: DESCRIPTION UNITS PRICE %_DISC V.A.T. AMOUNT
                # The format looks like: EAN DESC UNITS PRICE %DISC VAT% AMOUNT
                # Example: "8435635705389 LIFE PRO ALMOND BUTTER 300G 40,00 5,40 10,00 0,00% 194,40"
                # Example with thousands: "8425402168066 LIFE PRO ANTIAGING... 100,00 16,90 20,00 0,00% 1.352,00"
                # We need to correctly identify: units=40,00, price=5,40, amount=194,40
                
                # Extract all decimal numbers (with comma as decimal separator, including thousands separator)
                # Pattern matches: "352,00" or "1.352,00" or "10.234,56"
                decimal_numbers = re.findall(r'\d{1,3}(?:\.\d{3})*,\d{2}', remaining_line)
                
                # Extract percentage (ends with %)
                percentage_numbers = re.findall(r'\d+,\d{2}%', remaining_line)
                
                if len(decimal_numbers) >= 3:
                    # Expected pattern: DESCRIPTION UNITS PRICE %DISC VAT% AMOUNT
                    # decimal_numbers should contain: [units, price, disc, amount] (VAT% is separate)
                    try:
                        # Find the position pattern - units and price come first, amount comes last
                        # VAT percentage is separate, so we filter it out
                        clean_numbers = []
                        for num in decimal_numbers:
                            if num + '%' not in percentage_numbers:  # Skip VAT percentage
                                clean_numbers.append(num)
                        
                        if len(clean_numbers) >= 3:
                            quantity = parse_number(clean_numbers[0])  # First number: UNITS
                            unit_price = parse_number(clean_numbers[1])  # Second number: PRICE
                            total = parse_number(clean_numbers[-1])  # Last number: AMOUNT
                            # clean_numbers[2] would be discount percentage, skip it
                        else:
                            continue
                        
                        # Extract description (text between reference and numeric data)
                        # Look for the pattern where numeric data starts (usually units/quantity)
                        # Pattern: look for decimal numbers but preserve product names and details
                        desc_match = re.search(r'^(.*?)\s+(\d+,\d{2}\s+\d+,\d{2})', remaining_line)
                        if desc_match:
                            description = desc_match.group(1).strip()
                        else:
                            # Fallback: take everything before the first decimal number
                            first_num_match = re.search(r'(\d+,\d{2})', remaining_line)
                            if first_num_match:
                                desc_end = first_num_match.start()
                                description = remaining_line[:desc_end].strip()
                            else:
                                description = remaining_line.strip()
                        
                        # Look ahead for continuation lines, INCLUDING LOT/EXP lines
                        j = i + 1
                        while j < len(lines) and j < i + 5:  # Look at more lines for complete description
                            next_line = lines[j].strip()
                            # Stop if we hit the next product (starts with EAN code)
                            if (not next_line or 
                                re.match(r'^\d{8,15}', next_line) or  # Next product with EAN
                                'total' in next_line.lower() or
                                ('€' in next_line and re.search(r'\d+,\d{2}', next_line) and 'LOT:' not in next_line)):  # Line with prices but not LOT line
                                break
                            # Include ALL continuation lines including LOT: and EXP: lines
                            description += ' ' + next_line
                            j += 1
                        
                        # Clean up description
                        description = re.sub(r'\s+', ' ', description).strip()
                        description = re.sub(r'\s*€\s*', ' ', description).strip()
                        
                        # Remove footer information and promotional text that sometimes gets mixed in
                        # Look for patterns like "Indiex Sport Nutrition Spain" and remove everything after
                        footer_patterns = [
                            r'\s*Indiex Sport Nutrition Spain.*',
                            r'\s*C/ Segura nº.*',
                            r'\s*http://www\.indiex\.es.*',
                            r'\s*VAT: ESB\d+.*',
                            r'\s*Inscrita en el Registro.*',
                            r'\s*Madrid, Tomo.*',
                            r'\s*-\s*Promoción.*',
                            r'\s*LIFE PRO TRIBULUS PRO 90CAP - Promoción.*',
                            r'\s*SAUZERO ZERO CALORIES.*?- Promoción.*'
                        ]
                        for pattern in footer_patterns:
                            description = re.sub(pattern, '', description, flags=re.IGNORECASE)
                        
                        description = description.strip()
                        
                        # Look ahead for discount lines (negative quantities/totals) for the same SKU  
                        # Discount lines have the same description but end with " - Promoción"
                        discount_quantity = 0
                        discount_total = 0
                        
                        # Look at the next few lines for discount information (simplified to avoid infinite loops)
                        # IMPORTANT: Only check for discounts if they have the same reference number
                        for k in range(j, min(j + 3, len(lines))):  # Reduced from 5 to 3
                            if k >= len(lines):
                                break
                            next_line = lines[k].strip()
                            
                            # SIMPLIFIED: Only check if line contains the same reference and " - Promoción"
                            # This is fast and reliable, no complex string matching needed
                            is_discount_line = (reference in next_line and " - Promoción" in next_line)
                            
                            if is_discount_line:
                                print(f"DEBUG: Found discount line: '{next_line}'", file=sys.stderr)
                                # Extract numbers from the discount line
                                discount_numbers = re.findall(r'-?\d+,\d{2}', next_line)
                                if len(discount_numbers) >= 2:
                                    # For discount lines, the pattern is typically: negative_quantity negative_total
                                    # The first negative number is usually the quantity discount
                                    # The last negative number is usually the total discount
                                    for i, num_str in enumerate(discount_numbers):
                                        num_val = parse_number(num_str)
                                        if num_val < 0:  # Negative value indicates discount
                                            abs_val = abs(num_val)
                                            if i == 0:  # First negative number is usually quantity
                                                discount_quantity += abs_val
                                                print(f"DEBUG: Found discount quantity: {abs_val} for SKU {reference}", file=sys.stderr)
                                            elif i == len(discount_numbers) - 1:  # Last negative number is usually total
                                                discount_total += abs_val
                                                print(f"DEBUG: Found discount total: {abs_val} for SKU {reference}", file=sys.stderr)
                        
                        # Calculate final values after applying discounts
                        final_quantity = quantity - discount_quantity
                        final_total = total - discount_total
                        
                        # Validate the data makes sense and avoid true duplicates
                        # Debug: Print validation info for all items
                        print(f"DEBUG: Validation - Ref: {reference}, Qty: {final_quantity}, Price: {unit_price}, Total: {final_total}", file=sys.stderr)
                        
                        if unit_price > 0 and final_quantity > 0 and final_total > 0 and reference:
                            # Check for duplicates based on reference only (since we're merging discounts)
                            existing_references = [item['reference'] for item in invoice_data['order_items']]
                            
                            if reference not in existing_references:
                                invoice_data['order_items'].append({
                                    'reference': reference,
                                    'description': description,
                                    'quantity': str(int(final_quantity)),
                                    'unit_price': f"{unit_price:.2f}",
                                    'total': f"{final_total:.2f}"
                                })
                                # Debug: Print each item found
                                if discount_quantity > 0 or discount_total > 0:
                                    print(f"DEBUG: Found item with discount - Ref: {reference}, Qty: {quantity}->{final_quantity}, Total: {total}->{final_total}", file=sys.stderr)
                                else:
                                    print(f"DEBUG: Found item - Ref: {reference}, Qty: {final_quantity}, Price: {unit_price}, Total: {final_total}", file=sys.stderr)
                            else:
                                # If we find a duplicate reference, merge the quantities and totals
                                for item in invoice_data['order_items']:
                                    if item['reference'] == reference:
                                        # Merge quantities and totals
                                        existing_qty = int(item['quantity'])
                                        existing_total = float(item['total'])
                                        new_qty = existing_qty + int(final_quantity)
                                        new_total = existing_total + final_total
                                        
                                        item['quantity'] = str(new_qty)
                                        item['total'] = f"{new_total:.2f}"
                                        
                                        print(f"DEBUG: Merged duplicate item - Ref: {reference}, Qty: {existing_qty}+{final_quantity}={new_qty}, Total: {existing_total}+{final_total}={new_total:.2f}", file=sys.stderr)
                                        break
                        # If validation fails, skip this item
                        
                        i = j - 1  # Skip processed lines
                    except (IndexError, ValueError) as e:
                        continue
        
        i += 1
    
    # Check if we exited due to iteration limit
    if iterations >= max_iterations:
        print(f"WARNING: Reached max iterations ({max_iterations}) in item parsing loop, breaking to avoid infinite loop", file=sys.stderr)

    print(f"DEBUG: Exited item parsing loop after {iterations} iterations, found {len(invoice_data['order_items'])} items", file=sys.stderr)
    print(f"DEBUG: Starting totals extraction...", file=sys.stderr)
    
    # Extract totals using flexible pattern matching
    # First, try to find labeled totals in the text
    subtotal_from_text = None
    total_from_text = None
    vat_amount = None
    
    print(f"DEBUG: Searching for subtotal patterns...", file=sys.stderr)
    # Search for subtotal patterns (Base imponible, Subtotal, Total HT, etc.) - simplified
    try:
        subtotal_match = re.search(r'(?:base\s+imponible|subtotal|total\s+ht)[\s:]*€?\s*([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2})', text, re.IGNORECASE)
        if subtotal_match:
            subtotal_from_text = parse_number(subtotal_match.group(1))
            print(f"DEBUG: Found subtotal in text: {subtotal_match.group(1)} -> {subtotal_from_text}", file=sys.stderr)
    except Exception as e:
        print(f"DEBUG: Error searching for subtotal: {e}", file=sys.stderr)
    
    print(f"DEBUG: Searching for VAT patterns...", file=sys.stderr)
    # Search for VAT/IVA amount - simplified
    try:
        vat_match = re.search(r'(?:i\.?v\.?a\.?|vat)[\s:]*€?\s*([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2})', text, re.IGNORECASE)
        if vat_match:
            vat_amount = parse_number(vat_match.group(1))
            print(f"DEBUG: Found VAT amount in text: {vat_match.group(1)} -> {vat_amount}", file=sys.stderr)
    except Exception as e:
        print(f"DEBUG: Error searching for VAT: {e}", file=sys.stderr)
    
    print(f"DEBUG: Searching for total patterns...", file=sys.stderr)
    # Search for total patterns - simplified, just look for "total" with a number
    try:
        total_match = re.search(r'total[\s:]*€?\s*([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2})', text, re.IGNORECASE)
        if total_match:
            total_from_text = parse_number(total_match.group(1))
            print(f"DEBUG: Found total in text: {total_match.group(1)} -> {total_from_text}", file=sys.stderr)
    except Exception as e:
        print(f"DEBUG: Error searching for total: {e}", file=sys.stderr)
    
    # Calculate totals from line items as fallback/validation
    print(f"DEBUG: Calculating totals from {len(invoice_data['order_items'])} items...", file=sys.stderr)
    calculated_subtotal = 0.0
    if invoice_data['order_items']:
        try:
            calculated_subtotal = sum(float(item['total']) for item in invoice_data['order_items'])
            print(f"DEBUG: Calculated subtotal from items: {calculated_subtotal:.2f}", file=sys.stderr)
        except Exception as e:
            print(f"DEBUG: Error calculating subtotal: {e}", file=sys.stderr)
    
    # Determine final totals with priority logic
    print(f"DEBUG: Determining final totals...", file=sys.stderr)
    # Priority 1: Use subtotal from text if found, otherwise use calculated
    final_subtotal = subtotal_from_text if subtotal_from_text and subtotal_from_text > 0 else calculated_subtotal
    print(f"DEBUG: Final subtotal: {final_subtotal:.2f}", file=sys.stderr)
    
    # Priority 2: Use total from text if found, otherwise calculate from subtotal + VAT
    if total_from_text and total_from_text > 0:
        final_total = total_from_text
        print(f"DEBUG: Using total from text: {final_total:.2f}", file=sys.stderr)
    elif vat_amount and vat_amount > 0:
        final_total = final_subtotal + vat_amount
        print(f"DEBUG: Calculated total from subtotal + VAT: {final_total:.2f}", file=sys.stderr)
    else:
        final_total = final_subtotal
        print(f"DEBUG: Using subtotal as total: {final_total:.2f}", file=sys.stderr)
    
    print(f"DEBUG: Cross-checking totals...", file=sys.stderr)
    # Cross-check: warn if text total and calculated differ significantly
    if subtotal_from_text and calculated_subtotal > 0:
        difference = abs(subtotal_from_text - calculated_subtotal)
        if difference > 0.01:  # Allow 1 cent rounding difference
            print(f"WARNING: Subtotal mismatch - Text: {subtotal_from_text:.2f}, Calculated: {calculated_subtotal:.2f}, Diff: {difference:.2f}", file=sys.stderr)
    
    if total_from_text and calculated_subtotal > 0:
        # If we have a total from text but no subtotal, check against calculated
        if not subtotal_from_text:
            difference = abs(total_from_text - calculated_subtotal)
            if difference > 0.01:
                print(f"INFO: Total from text ({total_from_text:.2f}) differs from calculated subtotal ({calculated_subtotal:.2f}) - this is expected if VAT is included", file=sys.stderr)
    
    print(f"DEBUG: Setting final values in invoice_data...", file=sys.stderr)
    # Set final values
    if final_subtotal > 0:
        invoice_data['totals']['subtotal'] = f"{final_subtotal:.2f}"
    if final_total > 0:
        invoice_data['totals']['total'] = f"{final_total:.2f}"
    if vat_amount and vat_amount > 0:
        invoice_data['totals']['vat'] = f"{vat_amount:.2f}"
    
    print(f"DEBUG: Final totals set - Subtotal: {final_subtotal:.2f}, Total: {final_total:.2f}, VAT: {vat_amount or 0:.2f}", file=sys.stderr)

    # Debug: Print final results
    print(f"DEBUG: Final result - {len(invoice_data['order_items'])} items found", file=sys.stderr)
    print(f"DEBUG: Sample items: {invoice_data['order_items'][:2] if invoice_data['order_items'] else 'None'}", file=sys.stderr)
    print(f"DEBUG: Totals: {invoice_data.get('totals', {})}", file=sys.stderr)
    print(f"DEBUG: Metadata: {invoice_data.get('metadata', {})}", file=sys.stderr)
    print(f"DEBUG: parse_life_pro_invoice_text completed successfully", file=sys.stderr)

    return invoice_data

if __name__ == "__main__":
    print(f"DEBUG: Script started, sys.argv: {sys.argv}", file=sys.stderr)
    args = sys.argv[1:]
    pdf_path = "Life pro Facture.Pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    
    print(f"DEBUG: PDF path: {pdf_path}, JSON mode: {json_flag}", file=sys.stderr)
    
    try:
        print(f"DEBUG: Calling extract_life_pro_invoice_data...", file=sys.stderr)
        data = extract_life_pro_invoice_data(pdf_path)
        print(f"DEBUG: extract_life_pro_invoice_data completed", file=sys.stderr)
        
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
                data['vendor'] = {'name': 'Life Pro'}
            
            # Ensure totals are present
            if not data.get('totals'):
                data['totals'] = {}
            if not data.get('metadata'):
                data['metadata'] = {}
            
            # CRITICAL: Validate that we have items before returning success
            if not data.get('order_items') or len(data['order_items']) == 0:
                error_msg = "No invoice items found in PDF. The invoice may be in an unsupported format or corrupted."
                print(f"ERROR: {error_msg}", file=sys.stderr)
                print(json.dumps({"error": error_msg, "vendor": data.get('vendor', {}), "metadata": data.get('metadata', {}), "totals": data.get('totals', {})}, ensure_ascii=False))
                sys.exit(1)
            
            # Output clean JSON without any extra text
            print(f"DEBUG: Preparing JSON output...", file=sys.stderr)
            json_output = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
            print(f"DEBUG: JSON created, length: {len(json_output)}", file=sys.stderr)
            print(f"DEBUG: Final JSON output - items: {len(data.get('order_items', []))}, invoice_date: {data.get('metadata', {}).get('invoice_date', 'NOT_FOUND')}, total: {data.get('totals', {}).get('total', '0')}", file=sys.stderr)
            print(f"DEBUG: Writing JSON to stdout...", file=sys.stderr)
            print(json_output)
            print(f"DEBUG: JSON written successfully", file=sys.stderr)
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        
        print(f"DEBUG: Script completed successfully, exiting with code 0", file=sys.stderr)
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        print(f"ERROR: {error_msg}", file=sys.stderr)
        print(f"TRACEBACK: {traceback_str}", file=sys.stderr)
        error_data = {"error": error_msg, "traceback": traceback_str}
        if json_flag:
            print(json.dumps(error_data, ensure_ascii=False))
        else:
            print(f"Error: {e}")
            traceback.print_exc()
        sys.exit(1)
