from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTChar, LTRect, LTLine, LTTextBoxHorizontal
import re
from collections import defaultdict
import sys
import json

def extract_invoice_data(pdf_path):
    """Extract structured data from Inlead Nutrition invoices with better table parsing"""
    
    # Store extracted data
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
        
        # Collect all text elements with their positions
        for element in page_layout:
            if isinstance(element, LTTextContainer):
                for text_line in element:
                    if hasattr(text_line, 'get_text'):
                        text = text_line.get_text().strip()
                        if text:
                            elements.append({
                                'text': text,
                                'y': text_line.y0,
                                'x': text_line.x0
                            })
        
        # Sort elements by Y (top to bottom) and X (left to right)
        elements.sort(key=lambda x: (-x['y'], x['x']))
        
        # Process page text
        current_y = None
        for elem in elements:
            # New line when Y position changes significantly
            if current_y is None or abs(current_y - elem['y']) > 5:
                if page_text:
                    page_text += '\n'
                current_y = elem['y']
            page_text += elem['text'] + ' '
        
        full_text += f"\n--- PAGE {page_num + 1} ---\n" + page_text
    
    # Parse the extracted text
    return parse_invoice_text(full_text)

def parse_invoice_text(text):
    """Parse the extracted text to structured data with improved table handling"""
    
    # Initialize data structure
    invoice_data = {
        'vendor': {},
        'customer': {},
        'order_items': [],
        'totals': {},
        'metadata': {}
    }
    
    # Extract vendor information (appears at the top)
    vendor_match = re.search(r'Inlead Nutrition GmbH & Co\.KG · Wilhelmstrasse 14a · 59439 Holzwickede', text)
    if vendor_match:
        invoice_data['vendor']['name'] = 'Inlead Nutrition GmbH & Co.KG'
        invoice_data['vendor']['address'] = 'Wilhelmstrasse 14a, 59439 Holzwickede'
    
    # Extract customer information
    customer_match = re.search(r'Fitness World Nutrition\s+Herr Pierre-Yves BRUGNOT\s+rues des colonnes 9\s+75002 PARIS', text)
    if customer_match:
        invoice_data['customer']['name'] = 'Fitness World Nutrition'
        invoice_data['customer']['contact'] = 'Herr Pierre-Yves BRUGNOT'
        invoice_data['customer']['address'] = 'rues des colonnes 9, 75002 PARIS'
    
    # Robust line-based table parsing that aggregates wrapped description lines
    lines = text.split('\n')
    row_start_re = re.compile(r'^\s*(\d+)\s+([\d.,]+)\s+([A-Za-z0-9\-\.]+)\s+(.*)$')
    percent_re = re.compile(r'\d{1,2},\d{2}\s?%')
    money_re = re.compile(r'\d+[\.,]\d{2}\s?€?')
    is_new_row_re = re.compile(r'^\s*\d+\s+[\d.,]+\s+[A-Za-z0-9\-\.]')

    i = 0
    while i < len(lines):
        line = lines[i]
        m = row_start_re.match(line.strip())
        if not m:
            i += 1
            continue

        pos = m.group(1).strip()
        menge = m.group(2).strip()
        art_nr = m.group(3).strip()
        rest = m.group(4)

        # Determine cut position for description on the first line (before % or money)
        cut_idx = len(rest)
        mwst_match_in_rest = percent_re.search(rest)
        if mwst_match_in_rest:
            cut_idx = min(cut_idx, mwst_match_in_rest.start())
        money_match_in_rest = money_re.search(rest)
        if money_match_in_rest:
            cut_idx = min(cut_idx, money_match_in_rest.start())
        first_desc_part = rest[:cut_idx].strip()

        # Accumulate continuation lines belonging to this row's description
        j = i + 1
        continuation_parts = []
        row_block_lines = [line]
        while j < len(lines):
            next_line = lines[j]
            # Stop if next row begins or we hit common end markers/headers
            if is_new_row_re.match(next_line.strip()):
                break
            if ('Gesamt Netto' in next_line) or ('Rechnungsbetrag' in next_line) or next_line.startswith('--- PAGE') or ('Art.-Nr.' in next_line and 'Bezeichnung' in next_line):
                break
            
            # Stop if we encounter legal/footer text patterns
            if ('Persönlich haftende Gesellschafterin' in next_line or 
                'Inlead Nutrition Verwaltungs GmbH' in next_line or
                'Amtsgericht:' in next_line or
                'Geschäftsführer:' in next_line or
                'Sitz:' in next_line or
                'Seite:' in next_line):
                break

            # Treat any non-empty line as continuation of description, but cut off tax/price tokens
            cut_line_idx = len(next_line)
            mwst_match_line = percent_re.search(next_line)
            if mwst_match_line:
                cut_line_idx = min(cut_line_idx, mwst_match_line.start())
            money_match_line = money_re.search(next_line)
            if money_match_line:
                cut_line_idx = min(cut_line_idx, money_match_line.start())

            stripped = next_line[:cut_line_idx].strip()
            if stripped:
                continuation_parts.append(stripped)
            row_block_lines.append(next_line)
            j += 1

        # Build full description
        full_description = ' '.join([p for p in [first_desc_part] + continuation_parts if p])
        full_description = re.sub(r'\s+', ' ', full_description).strip()

        # Extract MwSt and prices from the accumulated row block
        row_block_text = ' '.join(row_block_lines)
        mwst_match = percent_re.search(row_block_text)
        money_matches = list(money_re.finditer(row_block_text))

        mwst = mwst_match.group(0) if mwst_match else ''
        # Choose the last two decimal numbers in the row as unit and total prices
        if len(money_matches) >= 2:
            unit_price = money_matches[-2].group(0)
            total_price = money_matches[-1].group(0)
        else:
            unit_price = ''
            total_price = ''

        invoice_data['order_items'].append({
            'position': pos,
            'quantity': menge.replace('.', '').replace(',', '.'),
            'article_number': art_nr,
            'description': full_description,
            'tax_rate': mwst,
            'unit_price': unit_price.replace('€', '').strip().replace(',', '.'),
            'total_price': total_price.replace('€', '').strip().replace(',', '.')
        })

        i = j if j > i else i + 1
    
    # Extract totals
    total_match = re.search(r'Gesamt Netto \(0,00 %\)\s+([\d.,]+ €)', text)
    if total_match:
        invoice_data['totals']['net_total'] = total_match.group(1).replace(',', '.').replace(' €', '')
    
    total_match = re.search(r'Rechnungsbetrag\s+([\d.,]+ €)', text)
    if total_match:
        invoice_data['totals']['invoice_total'] = total_match.group(1).replace(',', '.').replace(' €', '')
    
    # Extract metadata
    usi_match = re.search(r'Ihre USI-IdNr\.: (\w+)', text)
    if usi_match:
        invoice_data['metadata']['usi_id'] = usi_match.group(1)
    
    payment_match = re.search(r'Das Zahlungsziel beträgt (\d+) Tage ab Rechnungsdatum', text)
    if payment_match:
        invoice_data['metadata']['payment_terms'] = payment_match.group(1) + ' days'
    
    return invoice_data

def print_invoice_data(invoice_data):
    """Print the extracted invoice data in a readable format"""
    
    print("=" * 80)
    print("EXTRACTED INVOICE DATA")
    print("=" * 80)
    
    print("\nVENDOR:")
    print(f"  Name: {invoice_data['vendor'].get('name', 'N/A')}")
    print(f"  Address: {invoice_data['vendor'].get('address', 'N/A')}")
    
    print("\nCUSTOMER:")
    print(f"  Name: {invoice_data['customer'].get('name', 'N/A')}")
    print(f"  Contact: {invoice_data['customer'].get('contact', 'N/A')}")
    print(f"  Address: {invoice_data['customer'].get('address', 'N/A')}")
    
    print("\nORDER ITEMS:")
    print(f"{'Pos':<4} {'Qty':<6} {'Art-Nr':<8} {'Description':<50} {'Unit Price':<10} {'Total':<10}")
    print("-" * 90)
    for item in invoice_data['order_items']:
        desc = item['description']
        print(f"{item['position']:<4} {item['quantity']:<6} {item['article_number']:<8} {desc:<50} {item['unit_price']:<10} {item['total_price']:<10}")
    
    print("\nTOTALS:")
    for key, value in invoice_data['totals'].items():
        print(f"  {key.replace('_', ' ').title()}: {value} €")
    
    print("\nMETADATA:")
    for key, value in invoice_data['metadata'].items():
        print(f"  {key.replace('_', ' ').title()}: {value}")

if __name__ == "__main__":
    # Usage:
    #   python invoice_extractor-deepseek.py <pdf_path> [--json]
    # If --json is provided, prints a single JSON object with extracted data
    # If no path is provided, defaults to "Inlead.pdf"
    args = sys.argv[1:]
    pdf_path = "Inlead.pdf"
    json_flag = False
    for a in args:
        if a == "--json":
            json_flag = True
        elif not a.startswith('-'):
            pdf_path = a

    try:
        invoice_data = extract_invoice_data(pdf_path)
        if json_flag:
            # Emit machine-readable output for the Node runner (ASCII-only to avoid Windows encoding issues)
            print(json.dumps(invoice_data, ensure_ascii=True))
        else:
            print_invoice_data(invoice_data)

    except Exception as e:
        # Emit error in JSON if requested, otherwise human-friendly
        if json_flag:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error processing PDF: {e}")
            import traceback
            traceback.print_exc()