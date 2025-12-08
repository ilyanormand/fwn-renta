from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer
import re
import sys
import json

MAX_REALISTIC_QTY = 500  # Some Max Protein orders exceed 100 units


def extract_invoice_data(pdf_path):
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    # Extract elements with coordinates preserved
    all_page_elements = []
    for page_num, page_layout in enumerate(extract_pages(pdf_path)):
        for element in page_layout:
            if isinstance(element, LTTextContainer):
                for text_line in element:
                    if hasattr(text_line, 'get_text'):
                        text = text_line.get_text().strip()
                        if text:
                            all_page_elements.append({
                                'text': text,
                                'y': round(text_line.y0, 1),
                                'x': round(text_line.x0, 1),
                                'page': page_num
                            })

    return parse_invoice_with_structure(all_page_elements)


def parse_invoice_with_structure(elements):
    """Parse invoice using structural/positional information"""
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }

    def parse_number(s):
        """Parse a number string that may have spaces, commas, or dots"""
        if not s:
            return 0.0
        s = str(s).replace('€', '').replace('EUR', '').strip()
        
        # Handle different number formats:
        # "1,090.80" → 1090.80 (US format: comma as thousands separator)
        # "1.090,80" → 1090.80 (EU format: dot as thousands separator)
        # "120.00" → 120.00
        # "8.70" → 8.70
        
        if ',' in s and '.' in s:
            # Both separators present
            if s.rfind(',') > s.rfind('.'):
                # EU format: 1.090,80 → comma is decimal separator
                s = s.replace('.', '').replace(',', '.')
            else:
                # US format: 1,090.80 → comma is thousands separator
                s = s.replace(',', '')
        elif ',' in s:
            # Only comma: could be thousands or decimal
            parts = s.split(',')
            if len(parts) == 2 and len(parts[1]) == 2:
                # Looks like decimal: 10,50 → 10.50
                s = s.replace(',', '.')
            else:
                # Looks like thousands: 1,090 → 1090
                s = s.replace(',', '')
        # If only dot or no separator, keep as is
        
        try:
            return float(s)
        except:
            return 0.0

    # Step 1: Find SKU lines (items start here)
    sku_pattern = re.compile(r'\[\s*([A-Za-z0-9]+)\s*\]')
    sku_elements = []
    
    for elem in elements:
        match = sku_pattern.search(elem['text'])
        if match:
            sku_elements.append({
                'sku': match.group(1),
                'y': elem['y'],
                'x': elem['x'],
                'text': elem['text'],
                'page': elem['page']
            })
    
    # Step 2: Group elements by row (same Y coordinate)
    # Create a dict: y_coord -> list of elements
    rows = {}
    for elem in elements:
        y = elem['y']
        if y not in rows:
            rows[y] = []
        rows[y].append(elem)
    
    # Sort each row by X
    for y in rows:
        rows[y].sort(key=lambda e: e['x'])
    
    # Step 3: Analyze column structure by looking at X positions
    # Find common X positions (columns) across all rows
    all_x_positions = sorted(set(elem['x'] for elem in elements))
    
    # Group similar X positions (within 10 pixels) into columns
    columns = []
    current_col = [all_x_positions[0]]
    for x in all_x_positions[1:]:
        if x - current_col[-1] < 10:
            current_col.append(x)
        else:
            columns.append(sum(current_col) / len(current_col))  # Average X for this column
            current_col = [x]
    if current_col:
        columns.append(sum(current_col) / len(current_col))
    
    # Step 4: Identify column types by analyzing content patterns
    # Look at header row or first few data rows
    column_types = identify_column_types(rows, columns, elements)
    
    # Step 5: Extract items using structural information
    for sku_elem in sku_elements:
        item = extract_item_structured(
            sku_elem,
            rows,
            columns,
            column_types,
            parse_number
        )
        
        if item and item.get('quantity', '0') != '0':
            invoice_data['order_items'].append(item)
    
    return invoice_data


def identify_column_types(rows, columns, elements):
    """
    Identify what each column represents based on content patterns
    Returns dict: column_index -> type ('sku', 'description', 'quantity', 'unit_price', 'total')
    """
    column_types = {}
    
    # For Max Protein invoices, typical structure is:
    # Col 0 (~30-50 X): SKU + Description
    # Col 1 (~290-310 X): Quantity
    # Col 2 (~340-360 X): Unit Price (+ discount %)
    # Col 3 (~510-530 X): Total with €
    
    for i, col_x in enumerate(columns):
        if col_x < 100:
            column_types[i] = 'description'  # Left side: SKU + description
        elif 250 < col_x < 330:
            column_types[i] = 'quantity'  # Middle-left: quantity
        elif 330 < col_x < 400:
            column_types[i] = 'unit_price'  # Middle: unit price
        elif col_x > 450:
            column_types[i] = 'total'  # Right side: total amount
    
    return column_types


def get_column_index(x_pos, columns):
    """Find which column an X position belongs to"""
    if not columns:
        return None
    
    # Find closest column
    min_dist = float('inf')
    best_col = 0
    for i, col_x in enumerate(columns):
        dist = abs(x_pos - col_x)
        if dist < min_dist:
            min_dist = dist
            best_col = i
    
    # Only assign if within reasonable distance (50 pixels)
    if min_dist < 50:
        return best_col
    return None


def extract_item_structured(sku_elem, rows, columns, column_types, parse_number):
    """Extract a single item using structural/positional information"""
    sku = sku_elem['sku']
    item_y = sku_elem['y']
    
    # Get the row where this SKU appears
    if item_y not in rows:
        return None
    
    item_row = rows[item_y]
    
    # Extract description from SKU element
    sku_pattern = re.compile(r'\[\s*([A-Za-z0-9]+)\s*\]')
    description = sku_pattern.sub('', sku_elem['text']).strip()
    
    # Initialize values
    quantity = None
    unit_price = None
    total = None
    
    # Extract numbers from each column in this row
    for elem in item_row:
        col_idx = get_column_index(elem['x'], columns)
        if col_idx is None:
            continue
        
        col_type = column_types.get(col_idx)
        
        # Assign to appropriate field based on column type
        if col_type == 'quantity' and quantity is None:
            # Quantity column: parse the whole text to get the number
            quantity = parse_number(elem['text'])
            if quantity == 0:
                quantity = None
            
        elif col_type == 'unit_price' and unit_price is None:
            # Unit price column: may have "8.70 10.00" (price + discount %)
            # Extract individual numbers and take first non-round decimal
            numbers = re.findall(r'\d+[.,]\d{2}|\d+', elem['text'])
            for num_str in numbers:
                val = parse_number(num_str)
                if val > 0:
                    # Prefer non-round decimals (8.70 over 10.00)
                    if val != int(val):
                        unit_price = val
                        break
                    # Keep first number as fallback
                    if unit_price is None:
                        unit_price = val
                
        elif col_type == 'total' and total is None:
            # Total column: parse the whole text (handles "1,090.80 €")
            total = parse_number(elem['text'])
            if total == 0:
                total = None
    
    # Validation: check if qty * unit_price ≈ total
    if quantity and unit_price and total:
        expected = quantity * unit_price
        error = abs(expected - total)
        relative_error = error / max(total, 1.0)
        
        # If math doesn't check out (>30% error), try to find better combination
        if relative_error > 0.30:
            # Maybe we picked wrong values, try alternatives
            # Look in neighboring rows (sometimes data spans multiple lines)
            quantity, unit_price, total = try_multirow_extraction(
                item_y, rows, columns, column_types, parse_number
            )
    
    # Build item
    if quantity is not None and quantity > 0 and (unit_price or total):
        # Calculate missing value if we have 2 out of 3
        if total is None and quantity and unit_price:
            total = quantity * unit_price
        elif unit_price is None and quantity and total:
            unit_price = total / quantity if quantity > 0 else 0
        
        # Round quantity to integer if very close
        if abs(quantity - round(quantity)) < 0.1:
            quantity = int(round(quantity))
        else:
            quantity = int(quantity)
        
        return {
            'position': '',  # Will be set later
            'quantity': str(quantity),
                'article_number': sku,
                'description': description,
                'unit_price': f"{unit_price:.2f}",
                'total_price': f"{total:.2f}"
        }
    
    return None


def try_multirow_extraction(base_y, rows, columns, column_types, parse_number):
    """
    Try to extract qty/unit/total from nearby rows
    (sometimes Max Protein splits data across lines)
    """
    quantity = None
    unit_price = None
    total = None
    
    # Look in the next 2 rows below base_y
    nearby_y_values = [y for y in rows.keys() if 0 < (base_y - y) < 30]
    nearby_y_values.sort(reverse=True)  # Closest first
    
    for y in nearby_y_values[:2]:
        for elem in rows[y]:
            col_idx = get_column_index(elem['x'], columns)
            if col_idx is None:
                continue
            
            col_type = column_types.get(col_idx)
            numbers = re.findall(r'\d+[.,]\d{2}|\d+', elem['text'])
            
            if col_type == 'quantity' and quantity is None and numbers:
                quantity = parse_number(numbers[0])
            elif col_type == 'unit_price' and unit_price is None and numbers:
                unit_price = parse_number(numbers[0])
            elif col_type == 'total' and total is None and numbers:
                total = max(parse_number(num) for num in numbers)
    
    return quantity, unit_price, total


if __name__ == "__main__":
    args = sys.argv[1:]
    pdf_path = "Max protein.pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a
    try:
        data = extract_invoice_data(pdf_path)
        
        # Set position numbers
        for i, item in enumerate(data['order_items']):
            item['position'] = str(i + 1)
        
        if json_flag:
            print(json.dumps(data, ensure_ascii=True))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        if json_flag:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}")
