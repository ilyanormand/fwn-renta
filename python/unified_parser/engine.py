import json
import re
import sys
import os
from typing import Dict, Any, List, Optional
import pdfplumber
from .schemas import ParserConfig
from .utils import parse_number, clean_text, extract_regex_match, normalize_date

class UnifiedInvoiceParser:
    def __init__(self, pdf_path: str, config: ParserConfig):
        self.pdf_path = pdf_path
        self.config = config
        self.data = {
            'vendor': {
                'name': config.vendor.name,
                'currency': config.vendor.currency,
                'language': config.vendor.language
            },
            'customer': {},
            'order_items': [],
            'totals': {},
            'metadata': {}
        }
        self.full_text = ""
        self.pending_item = {}  # For multi-line regex parsing

    def extract(self) -> Dict[str, Any]:
        """Main extraction method."""
        try:
            with pdfplumber.open(self.pdf_path) as pdf:
                # 1. Extract full text for regex-based parsing
                self.full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
                
                # Preprocess text if needed
                if self.config.preprocess == "deduplicate":
                    self.full_text = self._deduplicate_text(self.full_text)
                # 1. Extract metadata
                self._extract_header()
                
                # 2. Extract table data
                if self.config.table.strategy == "pdfplumber_table":
                    self._extract_table_pdfplumber(pdf)
                elif self.config.table.strategy == "text_regex_multiline":
                    self._extract_table_regex_multiline()
                else:
                    self._extract_table_regex()
                
                # 4. Extract Footer/Totals
                self._extract_footer()
                
                # 5. Fallback calculations
                self._calculate_fallbacks()

                # 6. Apply global discount if present (e.g. Io Genix)
                self._apply_global_discount()

                # 7. Inlead Special Handling
                self._apply_inlead_logic()

                # 8. Dynveo Special Handling
                self._apply_dynveo_logic()

                # 9. Life Pro Special Handling (Merge negative items)
                self._apply_lifepro_logic()
                
        except Exception as e:
            # In production, we might want to log this better
            print(f"Error processing {self.pdf_path}: {e}", file=sys.stderr)
            raise e

        return self.data

    def _apply_inlead_logic(self):
        """
        Inlead invoices extract 'shipping_fee' into 'shipping_fee' field.
        But test-integration.ts expects 'shipping_fee' to be separate from total calculation if it's already part of items?
        No, Inlead invoices have items total, and shipping is sometimes an item "Pallet".
        
        In AU-202505-35143.pdf:
        Item 36: "Pallet", Unit Price 130.00, Total 130.00.
        This is a shipping cost.
        
        Our parser logic in `_process_item` tries to filter shipping rows.
        However, "Pallet" might not be in the keyword list.
        
        Let's add "pallet" to the keyword list in `_process_item`.
        """
        pass

    def _process_item(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process and validate a raw extracted item."""
        # --- Shaker Store Logic (Multi-line merging) - MUST BE FIRST ---
        if self.config.vendor.name == "Shaker Store":
            # Line 1: SKU + Description (no price/qty)
            # Note: regex match returns None for missing groups, so get() returns None
            if item.get('sku') and item.get('description') and not item.get('total'):
                self.pending_item = item.copy()
                return None
            
            # Line 2: Qty + Price + Total (no sku/desc)
            if item.get('total') and not item.get('sku') and not item.get('description'):
                if self.pending_item:
                    # Merge
                    merged = {**self.pending_item, **item}
                    self.pending_item = {}
                    item = merged
                else:
                    # Orphan line 2 - skip it
                    return None
        
        # Basic validation: must have at least a description, sku, or position
        if not item.get('description') and not item.get('sku') and not item.get('position'):
            return None
        
        description = item.get('description', '')
        description_lower = description.lower()

        # Extract SKU from description if missing (e.g. Max Protein "[000116] Desc")
        if not item.get('sku') and description.startswith('['):
            sku_match = re.match(r'^\[(.+?)\]', description)
            if sku_match:
                item['sku'] = sku_match.group(1)
                # Optional: Remove SKU from description?
                # item['description'] = description[sku_match.end():].strip()
        
        # Check if this is a shipping row - extract to totals and skip
        # Use regex for short words to avoid partial matches (e.g. 'cups' -> 'ups')
        is_shipping = False
        
        # Check SKU for delivery keywords (e.g., Shaker Store uses "DELIVERY" as SKU)
        sku = item.get('sku', '').upper()
        if sku in ['DELIVERY', 'SHIPPING', 'FREIGHT', 'VERSAND']:
            is_shipping = True
        # Strict keywords (word boundary)
        elif re.search(r'\b(ups|zone)\b', description_lower):
            is_shipping = True
        # Loose keywords (substring) - 'delivery' matches 'CourierDelivery'
        # Note: 'pallet' removed from here as pallets can be billable items
        elif any(text in description_lower for text in ['shipping', 'freight', 'fracht', 'delivery', 'versand', 'szállítás']):
            is_shipping = True
        # Also check 'position' field (for cases where description is None, e.g., Buchsteiner)
        elif item.get('position'):
            position_lower = str(item.get('position', '')).lower()
            if any(text in position_lower for text in ['shipping', 'freight', 'fracht', 'delivery', 'versand', 'szállítás']):
                is_shipping = True

        if is_shipping:
            # Try to extract shipping cost from total field
            try:
                shipping_cost = float(item.get('total', 0))
                if shipping_cost > 0:
                    # If shipping fee already exists, add to it
                    current_shipping = float(self.data.get('totals', {}).get('shipping_fee', 0))
                    self.data.setdefault('totals', {})['shipping_fee'] = str(current_shipping + shipping_cost)
            except (ValueError, TypeError):
                pass
            return None  # Skip shipping rows from items
        
        # Filter out footer/summary rows (e.g., "Gesamt Netto", "Gesamtbetrag", "Total", "Subtotal")
        footer_keywords = ['gesamt', 'total', 'subtotal', 'sum', 'tva', 'tax', 'net', 'brut']
        # Check position field (Buchsteiner uses this)
        if item.get('position'):
            position_lower = str(item.get('position', '')).lower()
            if any(keyword in position_lower for keyword in footer_keywords):
                return None
        # Also check description field
        if any(keyword in description_lower for keyword in footer_keywords):
            # Make sure it's not a product name containing these words
            # If description is very short and starts with footer keyword, skip it
            if len(description_lower.strip()) < 50 and any(description_lower.strip().startswith(kw) for kw in footer_keywords):
                return None
        
        # Filter out standalone metadata rows (rows that ONLY contain metadata text)
        metadata_patterns = [
            'expiry date:',
            'black friday',
            'deal of the month',
            'mega deal',
            'sample points',
            '(expires:',
        ]
        
        # Check if description is ONLY metadata (no product info)
        if any(pattern in description_lower for pattern in metadata_patterns):
            # If description starts with metadata pattern and has no product name, skip it
            if description_lower.strip().startswith(tuple(metadata_patterns)):
                return None

        # Clean description: remove metadata lines from multiline descriptions
        lines = description.split('\n')
        cleaned_lines = []
        for line in lines:
            line_lower = line.lower().strip()
            # Skip lines that are purely metadata
            if not any(pattern in line_lower for pattern in metadata_patterns):
                cleaned_lines.append(line.strip())
        
        # Update description with cleaned version
        if cleaned_lines:
            item['description'] = ' '.join(cleaned_lines)
        else:
            return None  # If nothing left after cleaning, skip this row
        
        # Calculate total if missing (e.g. Nutrimeo where we use HT price * Qty)
        # Exception: Yamamoto credit notes with 100% discount should have total=0
        if 'total' not in item and 'quantity' in item and 'unit_price' in item:
            if self.config.vendor.name == "Yamamoto Nutrition":
                # For Yamamoto, if total is missing, it means 100% discount (credit note)
                item['total'] = "0"
            else:
                try:
                    qty = float(item['quantity'])
                    price = float(item['unit_price'])
                    item['total'] = f"{qty * price:.2f}"
                except (ValueError, TypeError):
                    pass

        return item

    def _apply_lifepro_logic(self):
        """
        Life Pro invoices:
        Merge negative items (promotions/refunds) into the previous item.
        Adjust the TOTAL amount and recalculate UNIT PRICE.
        Keep the original QUANTITY of the main item.
        """
        if self.config.vendor.name.lower() != "life pro":
            return

        items = self.data.get('order_items', [])
        if not items:
            return

        merged_items = []
        
        i = 0
        while i < len(items):
            current_item = items[i]
            
            # Check if next item is a negative adjustment for the current item
            # Heuristic: Negative total, similar SKU or Description, or just next line?
            # The user said "negative number is attached to the item above".
            # Let's check if next item has negative total.
            
            if i + 1 < len(items):
                next_item = items[i+1]
                try:
                    next_total = float(next_item.get('total', 0))
                    if next_total < 0:
                        # Merge next_item into current_item
                        current_total = float(current_item.get('total', 0))
                        new_total = current_total + next_total
                        
                        # Update total
                        current_item['total'] = f"{new_total:.2f}"
                        
                        # Recalculate unit price based on original quantity
                        try:
                            qty = float(current_item.get('quantity', 0))
                            if qty != 0:
                                new_unit_price = new_total / qty
                                current_item['unit_price'] = f"{new_unit_price:.2f}"
                        except (ValueError, TypeError):
                            pass
                            
                        # Append current item and skip next
                        merged_items.append(current_item)
                        i += 2
                        continue
                except (ValueError, TypeError):
                    pass
            
            # If not merged, just add current
            merged_items.append(current_item)
            i += 1
            
        self.data['order_items'] = merged_items

    def _apply_dynveo_logic(self):
        """
        Dynveo invoices have a subtotal that is Net (after discount), but the extracted items
        are Gross (before discount).
        We need to ensure that the subtotal reported is consistent with the items total minus discount.
        """
        # Only apply if we have a discount and items
        totals = self.data.get('totals', {})
        discount_str = totals.get('discount')
        
        if not discount_str or not self.data.get('order_items'):
            return

        try:
            discount = float(discount_str)
            # Calculate items total (Gross)
            items_total = 0.0
            for item in self.data['order_items']:
                if item.get('total'):
                    items_total += float(item['total'])
            
            # If we have a subtotal extracted from footer (which is Net for Dynveo)
            if totals.get('subtotal'):
                subtotal_net = float(totals['subtotal'])
                
                # Check if Items Total (Gross) + Discount matches Subtotal (Net)
                # Note: discount is usually negative
                expected_net = items_total + discount
                
                # Logic to potentially adjust totals if needed, currently just pass
                # as test-integration handles the logic
                pass
                    
        except (ValueError, TypeError):
            pass

    def _extract_header(self):
        """Extract metadata based on header configuration."""
        for field in self.config.header.fields:
            value = extract_regex_match(self.full_text, field.regex, field.group)
            if value:
                target_dict = self.data.get(field.target, self.data['metadata'])
                if field.type == "date":
                    # Basic date normalization
                    target_dict[field.name] = normalize_date(value, self.config.vendor.language)
                else:
                    target_dict[field.name] = value

    def _extract_table_pdfplumber(self, pdf):
        """Extract table using pdfplumber's table extraction."""
        all_items = []
        seen_items = set()
        
        # Keep track of column indices across pages if they are consistent
        # But usually we should detect per table/page
        current_col_indices = None
        
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue

                # Check min columns if configured
                min_cols = getattr(self.config.table, 'min_columns', 0)
                if min_cols > 0:
                    if len(table[0]) < min_cols:
                        continue

                # Check if this table looks like our target table
                is_header_match = False
                header_row = None
                
                if self.config.table.header_keywords:
                    # Check first row
                    headers = [str(h).lower() if h else "" for h in table[0]]
                    matches = sum(1 for k in self.config.table.header_keywords if any(k.lower() in h for h in headers))
                    if matches >= 2:
                        is_header_match = True
                        header_row = table[0]
                
                # If no header match and we already have items, treat as continuation
                should_process = False
                start_row = 0

                if not self.config.table.header_keywords:
                    should_process = True
                elif is_header_match:
                    should_process = True
                    start_row = 1 # Skip header
                    # Detect indices from header
                    current_col_indices = self._detect_column_indices(header_row)
                elif len(all_items) > 0:
                    # Check if this table looks like data (continuation)
                    expected_cols = len(self.config.table.columns)
                    if len(table[0]) >= expected_cols - 2:
                        should_process = True
                        start_row = 0
                
                if not should_process:
                    continue

                # Process rows
                for row in table[start_row:]:
                    # Handle Io Genix special multiline row splitting
                    if self.config.vendor.name == "IO GENIX":
                        # Use detected indices if available, otherwise fallback to config/defaults
                        items = self._parse_iogenix_row(row, current_col_indices)
                        for item in items:
                            item_key = (item.get('sku'), item.get('quantity'), item.get('total'), item.get('unit_price'), item.get('description'))
                            if item_key not in seen_items:
                                seen_items.add(item_key)
                                all_items.append(item)
                        continue

                    # Handle multiline cells (standard logic)
                    should_split = False
                    if self.config.table.columns:
                         for col_config in self.config.table.columns:
                             if col_config.index is not None and col_config.index < len(row):
                                 cell = row[col_config.index]
                                 if isinstance(cell, str) and '\n' in cell:
                                     if col_config.type == "number":
                                         should_split = True
                                         break
                    else:
                         should_split = any(isinstance(cell, str) and '\n' in cell for cell in row if cell)
                    
                    if should_split:
                        # Split row into multiple rows
                        split_cells = []
                        max_lines = 0
                        for cell in row:
                            if isinstance(cell, str) and '\n' in cell:
                                lines = cell.split('\n')
                                split_cells.append(lines)
                                max_lines = max(max_lines, len(lines))
                            else:
                                split_cells.append([cell] if cell is not None else [])
                        
                        for i in range(max_lines):
                            new_row = []
                            for cell_lines in split_cells:
                                if i < len(cell_lines):
                                    new_row.append(cell_lines[i])
                                else:
                                    new_row.append("")
                            
                            # Filter rows with empty total column if configured
                            if self._is_valid_row(new_row):
                                item = self._parse_table_row(new_row)
                                if item:
                                    all_items.append(item)
                    else:
                        if self._is_valid_row(row):
                            item = self._parse_table_row(row)
                            if item:
                                all_items.append(item)
        
        self.data['order_items'] = all_items

    def _is_valid_row(self, row: List[str]) -> bool:
        """Check if row is valid based on required columns."""
        # Ensure total column is not empty string (if total column is defined)
        # Find total column index
        total_col_idx = -1
        for col in self.config.table.columns:
            if col.name == "total":
                total_col_idx = col.index
                break
        
        if total_col_idx != -1 and total_col_idx < len(row):
            val = row[total_col_idx]
            # Check if it's None or empty/whitespace
            if val is None or (isinstance(val, str) and not val.strip()):
                return False
        return True

    def _detect_column_indices(self, header_row: List[str]) -> Dict[str, int]:
        """Detect column indices from header row."""
        indices = {}
        if not header_row:
            return indices
            
        headers = [str(h).lower() if h else "" for h in header_row]
        
        # Define keywords for each column type
        keywords = {
            'sku': ['reference', 'referencia', 'ref'],
            'description': ['description', 'conceptos', 'descripción'],
            'quantity': ['quantity', 'cantidad', 'cant'],
            'unit_price': ['price', 'precio'],
            'total': ['total', 'importe']
        }
        
        for col_name, kws in keywords.items():
            for i, h in enumerate(headers):
                if any(kw in h for kw in kws):
                    indices[col_name] = i
                    break
        
        return indices

    def _parse_iogenix_row(self, row: List[str], col_indices: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
        """Special parser for Io Genix rows which pack multiple items into one row."""
        items = []
        
        # Default indices (fallback)
        col_sku = 0
        col_desc = 2
        col_qty = 7
        col_price = 8
        col_total = 12
        
        # Use detected indices if available
        if col_indices:
            col_sku = col_indices.get('sku', col_sku)
            col_desc = col_indices.get('description', col_desc)
            col_qty = col_indices.get('quantity', col_qty)
            col_price = col_indices.get('unit_price', col_price)
            col_total = col_indices.get('total', col_total)
        
        # Safety check
        max_idx = max(col_sku, col_desc, col_qty, col_price, col_total)
        if len(row) <= max_idx:
            # Try to handle if row is shorter but has enough columns for some fields?
            # Or just return empty
            if len(row) <= col_total: # At least up to total?
                 return []
            
        skus = str(row[col_sku] or "").split('\n')
        descriptions = str(row[col_desc] or "").split('\n')
        quantities = str(row[col_qty] or "").split('\n')
        prices = str(row[col_price] or "").split('\n')
        totals = str(row[col_total] or "").split('\n')
        
        # Filter out empty lines
        valid_skus = [s for s in skus if s.strip()]
        valid_quantities = [q for q in quantities if q.strip()]
        valid_prices = [p for p in prices if p.strip()]
        valid_totals = [t for t in totals if t.strip()]
        
        item_count = len(valid_skus)
        if item_count == 0:
            return []
            
        full_description = "\n".join(descriptions)
        
        # Smart alignment for totals
        total_idx = 0
        
        for i in range(item_count):
            item = {}
            item['sku'] = valid_skus[i].strip()
            
            if i == 0:
                item['description'] = clean_text(full_description)
            else:
                item['description'] = "" 
                
            qty = 0.0
            price = 0.0
            
            if i < len(valid_quantities):
                try:
                    qty = parse_number(valid_quantities[i])
                    item['quantity'] = str(qty)
                except:
                    pass
            
            if i < len(valid_prices):
                try:
                    price = parse_number(valid_prices[i])
                    item['unit_price'] = str(price)
                except:
                    pass
            
            # Calculate expected total
            calc_total = qty * price
            
            # Try to match with valid_totals
            matched_total = False
            if total_idx < len(valid_totals):
                try:
                    candidate_total = parse_number(valid_totals[total_idx])
                    # Allow small difference (e.g. rounding)
                    if abs(candidate_total - calc_total) < 0.05 or (calc_total == 0 and candidate_total > 0): 
                        # If calc_total is 0 (maybe missing qty/price), we might accept candidate?
                        # But usually we trust calc_total if qty/price are valid.
                        # Let's be strict: if match, use it.
                        item['total'] = str(candidate_total)
                        total_idx += 1
                        matched_total = True
                    elif abs(candidate_total - calc_total) > 0.05:
                        # Mismatch. 
                        # Check if it matches the NEXT item's expected total? (Lookahead)
                        # If lookahead matches, then THIS item's total is missing.
                        # If lookahead doesn't match, maybe THIS item's total is candidate (and calc is wrong?)
                        
                        # Simple heuristic: If mismatch, assume missing total for this item, use calculated.
                        # UNLESS calc_total is 0, then maybe we should take candidate?
                        if calc_total > 0:
                            item['total'] = f"{calc_total:.2f}"
                        else:
                             # If we can't calculate, and candidate is there... risky.
                             pass
                except:
                    pass
            
            if not item.get('total') and calc_total > 0:
                 item['total'] = f"{calc_total:.2f}"

            # Filter out footer rows (same logic as before)
            if item.get('sku'):
                sku_clean = item['sku'].replace('.', '').replace(',', '')
                if sku_clean.isdigit() and len(item['sku']) > 5 and ',' in item['sku'] and '.' in item['sku']:
                     continue 
                if any(kw in item['sku'].upper() for kw in ["GROSS", "AMOUNT", "IMPORTANT", "SUPPLIER", "TAXABLE", "SHIPPING", "DISCOUNT"]):
                     continue
            
            if not item.get('description') and not item.get('sku'):
                continue

            processed = self._process_item(item)
            if processed:
                items.append(processed)
                
        return items

    def _extract_table_regex(self):
        """Extract table using line-by-line regex pattern matching."""
        lines = self.full_text.split('\n')
        in_table = False
        items = []
        
        # Get row pattern - it should be defined in the config
        row_pattern = getattr(self.config.table, 'row_pattern', None)
        if not row_pattern:
            print("Warning: text_regex strategy requires row_pattern in config", file=sys.stderr)
            return
        
        for line in lines:
            # Check start marker
            if self.config.table.start_marker and re.search(self.config.table.start_marker, line, re.IGNORECASE):
                in_table = True
                continue
            
            # Check end marker
            if self.config.table.end_marker and re.search(self.config.table.end_marker, line, re.IGNORECASE):
                in_table = False
                # break removed to allow multi-page tables with repeated headers/footers
                continue
                
            # Only process lines within the table boundaries
            if in_table or not self.config.table.start_marker:
                # Check for FID (SKU) line - common in Naskorsports
                fid_match = re.search(r'FID:\s*(\d+)', line)
                if fid_match and items:
                    items[-1]['sku'] = fid_match.group(1)
                    continue

                # Try to match the row pattern
                match = re.search(row_pattern, line.strip())
                if match:
                    item = {}
                    # Map regex groups to columns
                    for col_config in self.config.table.columns:
                        regex_group = getattr(col_config, 'regex_group', None)
                        if regex_group is not None:
                            try:
                                raw_value = match.group(regex_group)
                                if raw_value is None:
                                    continue
                                
                                if col_config.type == "number":
                                    val = parse_number(raw_value)
                                    if val.is_integer():
                                        item[col_config.name] = str(int(val))
                                    else:
                                        item[col_config.name] = str(val)
                                else:
                                    item[col_config.name] = clean_text(raw_value)
                            except IndexError:
                                pass  # Group doesn't exist in this match
                    
                    # Post-process item (filter shipping, etc.)
                    processed_item = self._process_item(item)
                    if processed_item:
                        items.append(processed_item)
        
        self.data['order_items'] = items
    
    def _extract_table_regex_multiline(self):
        """Extract table using regex patterns on the full table section (for LABZ with dual formats)."""
        # Extract the table section
        table_start_idx = 0
        table_end_idx = len(self.full_text)
        
        if self.config.table.start_marker:
            start_match = re.search(self.config.table.start_marker, self.full_text, re.IGNORECASE)
            if start_match:
                table_start_idx = start_match.end()
        
        if self.config.table.end_marker:
            end_match = re.search(self.config.table.end_marker, self.full_text[table_start_idx:], re.IGNORECASE)
            if end_match:
                table_end_idx = table_start_idx + end_match.start()
        
        table_text = self.full_text[table_start_idx:table_end_idx]
        
        items = []
        row_pattern = getattr(self.config.table, 'row_pattern', None)
        row_pattern_alt = getattr(self.config.table, 'row_pattern_alt', None)
        
        if not row_pattern:
            print("Warning: text_regex_multiline strategy requires row_pattern in config", file=sys.stderr)
            return
        
        # Try primary pattern
        for match in re.finditer(row_pattern, table_text, re.DOTALL):
            item = {}
            for col_config in self.config.table.columns:
                regex_group = getattr(col_config, 'regex_group', None)
                if regex_group is not None:
                    try:
                        raw_value = match.group(regex_group)
                        if col_config.type == "number":
                            val = parse_number(raw_value)
                            if val.is_integer():
                                item[col_config.name] = str(int(val))
                            else:
                                item[col_config.name] = str(val)
                        else:
                            item[col_config.name] = clean_text(raw_value)
                    except IndexError:
                        pass
            
            processed_item = self._process_item(item)
            if processed_item:
                items.append(processed_item)
        
        # Try alternate pattern if configured
        if row_pattern_alt:
            columns_alt = getattr(self.config.table, 'columns_alt', None)
            if columns_alt:
                for match in re.finditer(row_pattern_alt, table_text, re.DOTALL):
                    item = {}
                    for col_config in columns_alt:
                        regex_group = getattr(col_config, 'regex_group', None)
                        if regex_group is not None:
                            try:
                                raw_value = match.group(regex_group)
                                if col_config.type == "number":
                                    val = parse_number(raw_value)
                                    if val.is_integer():
                                        item[col_config.name] = str(int(val))
                                    else:
                                        item[col_config.name] = str(val)
                                else:
                                    item[col_config.name] = clean_text(raw_value)
                            except IndexError:
                                pass
                    
                    processed_item = self._process_item(item)
                    if processed_item:
                        items.append(processed_item)
        
        self.data['order_items'] = items


    def _parse_table_row(self, row: List[str]) -> Optional[Dict[str, Any]]:
        """Parse a single row from pdfplumber table."""
        item = {}
        
        # Remove None values
        row = [cell if cell is not None else "" for cell in row]
        
        # Check if row is empty or just whitespace
        if not any(row) or all(c.strip() == "" for c in row):
            return None

        # Map columns
        for col_config in self.config.table.columns:
            if col_config.index is not None and col_config.index < len(row):
                raw_value = row[col_config.index]
                
                # Apply deduplication if configured
                if self.config.preprocess == "deduplicate" and raw_value:
                    raw_value = self._deduplicate_text(str(raw_value))
                
                if col_config.type == "number":
                    val = parse_number(raw_value)
                    if val.is_integer():
                        item[col_config.name] = str(int(val))
                    else:
                        item[col_config.name] = str(val)
                else:
                    item[col_config.name] = clean_text(raw_value)
        
        return self._process_item(item)

    def _extract_footer(self):
        """Extract totals based on footer configuration."""
        for field in self.config.footer.fields:
            value = extract_regex_match(self.full_text, field.regex, field.group)
            if value:
                if field.type == "number":
                    self.data['totals'][field.name] = str(parse_number(value))
                else:
                    self.data['totals'][field.name] = value

    def _calculate_fallbacks(self):
        """Calculate missing totals from line items."""
        if not self.data['totals'].get('subtotal') and self.data['order_items']:
            subtotal = 0.0
            for item in self.data['order_items']:
                # Try to find total in item
                if item.get('total'):
                    subtotal += float(item['total'])
                elif item.get('quantity') and item.get('unit_price'):
                    subtotal += float(item['quantity']) * float(item['unit_price'])
            
            self.data['totals']['subtotal'] = f"{subtotal:.2f}"

    def _apply_global_discount(self):
        """Apply global discount to unit prices if gross_amount and discount_amount are present."""
        totals = self.data.get('totals', {})
        gross_amount_str = totals.get('gross_amount')
        discount_amount_str = totals.get('discount_amount')
        
        if gross_amount_str and discount_amount_str:
            try:
                gross = float(gross_amount_str)
                discount = float(discount_amount_str)
                
                if gross > 0 and discount > 0:
                    discount_ratio = discount / gross
                    # Apply to all items
                    for item in self.data.get('order_items', []):
                        if item.get('unit_price'):
                            try:
                                original_price = float(item['unit_price'])
                                new_price = original_price * (1 - discount_ratio)
                                if new_price.is_integer():
                                    item['unit_price'] = str(int(new_price))
                                else:
                                    item['unit_price'] = f"{new_price:.2f}"
                                    
                                # Also update total if present
                                if item.get('total'):
                                    original_total = float(item['total'])
                                    new_total = original_total * (1 - discount_ratio)
                                    if new_total.is_integer():
                                        item['total'] = str(int(new_total))
                                    else:
                                        item['total'] = f"{new_total:.2f}"
                            except (ValueError, TypeError):
                                pass
            except (ValueError, TypeError):
                pass
            
            if not self.data['totals'].get('total'):
                 self.data['totals']['total'] = f"{subtotal:.2f}" # Assume no tax if not found? Or just leave it.
   
    def to_json(self) -> str:
        return json.dumps(self.data, ensure_ascii=False, indent=2)

    def _deduplicate_text(self, text: str) -> str:
        """Fix doubled text (e.g. 'RRaaww' -> 'Raw')."""
        if not text:
            return ""
        
        result = []
        i = 0
        n = len(text)
        
        while i < n:
            char = text[i]
            if i + 1 < n and text[i+1] == char:
                result.append(char)
                i += 2
            else:
                result.append(char)
                i += 1
                
        return "".join(result)
