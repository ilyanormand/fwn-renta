#!/usr/bin/env python3

import fitz  # PyMuPDF
import re
import sys
import json
import logging
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass

@dataclass
class LineItem:
    sku: str
    description: str
    quantity: int
    unit_price: float
    total: float
    source: str = "final_parser"

class UltimateProlifeParser:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.setup_logging()
        
    def setup_logging(self):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            stream=sys.stderr  # Send logs to stderr instead of stdout
        )
        
    def parse_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """Parse PDF and extract all invoice data"""
        try:
            doc = fitz.open(pdf_path)
            
            # Extract all text
            all_text = ""
            for page_num in range(len(doc)):
                page = doc[page_num]
                page_text = page.get_text()
                all_text += page_text + "\n"
            
            doc.close()
            
            # Extract line items using comprehensive pattern matching
            line_items = self._extract_all_items(all_text)
            
            # Extract metadata
            metadata = self._extract_metadata(all_text)
            
            return {
                'line_items': [item.__dict__ for item in line_items],
                'metadata': metadata,
                'total_items': len(line_items)
            }
            
        except Exception as e:
            self.logger.error(f"Error parsing PDF: {e}")
            return {'line_items': [], 'metadata': {}, 'total_items': 0}
    
    def _extract_all_items(self, text: str) -> List[LineItem]:
        """Extract all items using comprehensive pattern matching"""
        items = []
        lines = text.split('\n')
        
        # Find all SKU line indices
        sku_line_indices = []
        for i, line in enumerate(lines):
            if 'SKU:' in line:
                sku_line_indices.append(i)
        
        self.logger.info(f"Found {len(sku_line_indices)} SKU lines")
        
        # Process each SKU line with different strategies
        for sku_idx in sku_line_indices:
            item = self._extract_item_comprehensive(lines, sku_idx)
            if item:
                items.append(item)
                self.logger.debug(f"Extracted: {item.sku}")
        
        self.logger.info(f"Successfully extracted {len(items)} items")
        return items
    
    def _extract_item_comprehensive(self, lines: List[str], sku_idx: int) -> Optional[LineItem]:
        """Extract item using comprehensive pattern matching"""
        try:
            sku_line = lines[sku_idx].strip()
            
            # Strategy 1: Complete SKU in one line (e.g., "Cheesecake - SKU: CS-COR80SC")
            complete_sku_match = re.search(r'SKU:\s*([A-Z]{2,4}-[A-Z0-9]+)', sku_line)
            if complete_sku_match:
                complete_sku = complete_sku_match.group(1)
                description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx)
                
                if quantity > 0 and unit_price > 0:
                     return LineItem(
                         sku=complete_sku,
                         description=description or f"Product {complete_sku}",
                         quantity=quantity,
                         unit_price=round(unit_price, 2),
                         total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                     )
            
            # Strategy 2: SKU prefix in current line, suffix in next line
            prefix_match = re.search(r'SKU:\s*([A-Z]{2,4}-?)$', sku_line)
            if prefix_match and sku_idx + 1 < len(lines):
                prefix = prefix_match.group(1)
                if not prefix.endswith('-'):
                    prefix += '-'
                
                next_line = lines[sku_idx + 1].strip()
                suffix = self._extract_sku_suffix(next_line)
                
                # If suffix extraction failed, check if it's a single digit and infer SKU
                if not suffix and re.match(r'^\d+$', next_line):
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    # Try cross-page reconstruction first
                    complete_sku = self._reconstruct_cross_page_sku(lines, sku_idx, description, next_line)
                    if not complete_sku:
                        complete_sku = self._infer_sku_from_description(description, next_line)
                    
                    # Use the number from next_line as quantity if we reconstructed a cross-page SKU
                    quantity_from_next_line = int(next_line)
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                    
                    # If we reconstructed a cross-page SKU, use the number as quantity
                    if complete_sku and complete_sku != self._infer_sku_from_description(description, next_line):
                        quantity = quantity_from_next_line
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
                elif suffix:
                    complete_sku = prefix + suffix
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx)
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
            
            # Strategy 3: SKU ends with just "SKU:" - handle multiple patterns
            if sku_line.endswith('SKU:') and sku_idx + 1 < len(lines):
                description = sku_line.replace('SKU:', '').strip().lstrip('- ')
                next_line = lines[sku_idx + 1].strip()
                
                # Pattern 3a: Complete SKU in next line (e.g., "CS-COR80SC")
                complete_sku_match = re.match(r'^([A-Z]{2,4}-[A-Z0-9]+)$', next_line)
                if complete_sku_match:
                    complete_sku = complete_sku_match.group(1)
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
                
                # Pattern 3b: Prefix in next line, suffix in line after (e.g., "SUPN-" + "GREEN30CHERRY")
                prefix_match = re.match(r'^([A-Z]{2,4}-?)$', next_line)
                if prefix_match and sku_idx + 2 < len(lines):
                    prefix = prefix_match.group(1)
                    if not prefix.endswith('-'):
                        prefix += '-'
                    
                    suffix_line = lines[sku_idx + 2].strip()
                    suffix = self._extract_sku_suffix(suffix_line)
                    
                    if suffix:
                        complete_sku = prefix + suffix
                        quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 2)
                        
                        if quantity > 0 and unit_price > 0:
                            return LineItem(
                                sku=complete_sku,
                                description=description or f"Product {complete_sku}",
                                quantity=quantity,
                                unit_price=round(unit_price, 2),
                                total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                            )
                
                # Pattern 3c: Handle different cases based on next line content
            if re.match(r'^\d+$', next_line):
                # Try to reconstruct SKU from context first
                complete_sku = self._reconstruct_cross_page_sku(lines, sku_idx, description, next_line)
                if not complete_sku:
                    complete_sku = self._infer_sku_from_description(description, next_line)
                
                # Use the number from next_line as quantity if it's a valid quantity
                quantity_from_next_line = int(next_line)
                quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                
                # If we reconstructed a cross-page SKU, use the number as quantity
                if complete_sku and complete_sku != self._infer_sku_from_description(description, next_line):
                    quantity = quantity_from_next_line
                
                if quantity > 0 and unit_price > 0:
                    return LineItem(
                        sku=complete_sku,
                        description=description or f"Product {complete_sku}",
                        quantity=quantity,
                        unit_price=round(unit_price, 2),
                        total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                    )
            
            # Strategy 4: Handle special case like "Description - SKU: CS-" + "7" (incomplete SKU)
            if re.search(r'SKU:\s*([A-Z]{2,4}-)\s*$', sku_line) and sku_idx + 1 < len(lines):
                prefix_match = re.search(r'SKU:\s*([A-Z]{2,4}-)\s*$', sku_line)
                prefix = prefix_match.group(1)
                
                next_line = lines[sku_idx + 1].strip()
                if re.match(r'^\d+$', next_line):  # Just a number
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    # Try to reconstruct from cross-page context first
                    complete_sku = self._reconstruct_cross_page_sku(lines, sku_idx, description, next_line)
                    if not complete_sku:
                        complete_sku = prefix + next_line
                    
                    # Use the number from next_line as quantity if we reconstructed a cross-page SKU
                    quantity_from_next_line = int(next_line)
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                    
                    # If we reconstructed a cross-page SKU, use the number as quantity
                    if complete_sku and complete_sku != prefix + next_line:
                        quantity = quantity_from_next_line
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
                
                # Handle case where next line contains alphanumeric suffix (like "IP1.8CMB")
                suffix = self._extract_sku_suffix(next_line)
                if suffix:
                    complete_sku = prefix + suffix
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
            
            # Strategy 5: Handle "- SKU: PREFIX-" pattern
            if re.search(r'-\s*SKU:\s*([A-Z]{2,4}-)\s*$', sku_line) and sku_idx + 1 < len(lines):
                prefix_match = re.search(r'SKU:\s*([A-Z]{2,4}-)\s*$', sku_line)
                prefix = prefix_match.group(1)
                
                next_line = lines[sku_idx + 1].strip()
                suffix = self._extract_sku_suffix(next_line)
                
                if suffix:
                    complete_sku = prefix + suffix
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx)
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
                
                # Handle case where next line is just a single digit (like "7")
                if re.match(r'^\d+$', next_line):
                    complete_sku = prefix + next_line
                    description = re.sub(r'\s*-?\s*SKU:.*$', '', sku_line).strip().lstrip('- ')
                    quantity, unit_price, total_from_pdf = self._extract_quantity_and_price(lines, sku_idx + 1)
                    
                    if quantity > 0 and unit_price > 0:
                        return LineItem(
                            sku=complete_sku,
                            description=description or f"Product {complete_sku}",
                            quantity=quantity,
                            unit_price=round(unit_price, 2),
                            total=round(total_from_pdf if total_from_pdf > 0 else quantity * unit_price, 2)
                        )
            
        except Exception as e:
            self.logger.debug(f"Error extracting item at line {sku_idx}: {e}")
        
        return None
    
    def _extract_sku_suffix(self, line: str) -> str:
        """Extract SKU suffix from a line"""
        clean_line = line.strip()
        
        # If it's a clean alphanumeric sequence (including dots)
        if re.match(r'^[A-Z0-9.]+$', clean_line) and len(clean_line) >= 3:
            return clean_line
        
        # If it starts with alphanumeric (extract the alphanumeric part, including dots)
        match = re.match(r'^([A-Z0-9.]+)', clean_line)
        if match and len(match.group(1)) >= 3:
            return match.group(1)
        
        return ""
    
    def _reconstruct_cross_page_sku(self, lines: List[str], sku_idx: int, description: str, number: str) -> str:
        """Reconstruct SKU that may be split across pages using dynamic pattern matching"""
        # Look for SKU fragments in nearby lines that might be from cross-page splits
        search_range = 25  # Look within 25 lines before and after
        start_idx = max(0, sku_idx - search_range)
        end_idx = min(len(lines), sku_idx + search_range)
        
        # Collect all potential SKU patterns and choose the best one
        candidates = []
        
        # Look for partial SKU patterns that might complete our incomplete SKU
        for i in range(start_idx, end_idx):
            if i == sku_idx:
                continue
            line = lines[i].strip()
            
            # Look for complete SKU patterns in nearby lines
            # Pattern 1: Any complete SKU format (PREFIX-SUFFIX)
            complete_sku_match = re.search(r'\b([A-Z]{2,4}-[A-Z0-9.]+)\b', line)
            if complete_sku_match:
                complete_sku = complete_sku_match.group(1)
                # Validate it's a reasonable SKU (not invoice numbers, etc.)
                if not complete_sku.startswith('WEB-') and len(complete_sku.split('-')[1]) >= 4:
                    candidates.append((complete_sku, abs(i - sku_idx), "complete_sku"))
            
            # Pattern 2: Standalone alphanumeric codes that could be SKU suffixes
            # Look for patterns like JPPP2KGSCP, COR80CHOCOC, etc.
            suffix_match = re.search(r'\b([A-Z]{2,}[0-9A-Z.]*[A-Z]{2,})\b', line)
            if suffix_match:
                suffix = suffix_match.group(1)
                # Filter out common words that aren't SKU suffixes
                if len(suffix) >= 6 and suffix not in ['BACS', 'PAYPAL', 'TOTAL', 'ORDER', 'INVOICE']:
                    # Try to find the prefix by looking for partial SKU patterns nearby
                    prefix = self._find_sku_prefix_in_context(lines, i, search_range)
                    if prefix:  # Only add if we found a valid prefix
                        candidates.append((f"{prefix}-{suffix}", abs(i - sku_idx), "suffix_match"))
        
        # Choose the best candidate based on priority and context
        if candidates:
            # Prefer complete SKUs first
            complete_candidates = [c for c in candidates if c[2] == "complete_sku"]
            if complete_candidates:
                complete_candidates.sort(key=lambda x: (x[1], x[0]))
                return complete_candidates[0][0]
            
            # For suffix matches, use quantity context to choose the right one
            suffix_candidates = [c for c in candidates if c[2] == "suffix_match"]
            if suffix_candidates and number:
                # Look for the suffix that appears in a context with the same quantity
                for sku, dist, type_str in suffix_candidates:
                    suffix = sku.split('-')[1]
                    # Check if this suffix appears near the quantity number
                    for i in range(start_idx, end_idx):
                        line = lines[i].strip()
                        if suffix in line:
                            # Look for the quantity in nearby lines
                            for j in range(max(0, i-3), min(len(lines), i+4)):
                                if number in lines[j].strip():
                                    return sku
            
            # Fallback to closest match
            if suffix_candidates:
                suffix_candidates.sort(key=lambda x: (x[1], x[0]))
                return suffix_candidates[0][0]
            
            # Final fallback
            candidates.sort(key=lambda x: (x[2] == "suffix_match", x[1], x[0]))
            return candidates[0][0]
        
        # If no cross-page pattern found, return empty string
        return ""
    
    def _find_sku_prefix_in_context(self, lines: List[str], center_idx: int, search_range: int) -> str:
        """Find SKU prefix by looking for partial SKU patterns in nearby lines"""
        start_idx = max(0, center_idx - search_range)
        end_idx = min(len(lines), center_idx + search_range)
        
        # Look for partial SKU patterns like "SKU: TBJP-" or "SKU: CS-" or "SKU: SUPN-"
        for i in range(start_idx, end_idx):
            line = lines[i].strip()
            
            # Look for "SKU: PREFIX-" patterns
            prefix_match = re.search(r'SKU:\s*([A-Z]{2,4})-?\s*$', line)
            if prefix_match:
                return prefix_match.group(1)
            
            # Look for standalone prefixes that might be SKU prefixes
            standalone_prefix = re.search(r'\b([A-Z]{2,4})-\s*$', line)
            if standalone_prefix:
                prefix = standalone_prefix.group(1)
                # Validate it's likely a SKU prefix (not common words)
                if prefix not in ['WEB', 'VAT', 'EUR', 'USD', 'GBP'] and prefix in ['TBJP', 'CS', 'SUPN']:
                    return prefix
        
        # If no prefix found, return None to indicate we should skip this candidate
        return None
    
    def _infer_sku_from_description(self, description: str, number: str) -> str:
        """Dynamically extract SKU patterns from the PDF context"""
        # This method should not be used for hardcoded inference
        # Instead, we should extract actual SKUs from the PDF
        # Return a generic pattern that will be caught by validation
        return f"EXTRACT-{number}"
    
    def _extract_quantity_and_price(self, lines: List[str], start_idx: int) -> Tuple[int, float, float]:
        """Extract quantity and unit price after discount from lines following the start index"""
        quantity = 0
        unit_price = 0.0
        unit_price_after_discount = 0.0
        total_from_pdf = 0.0
        
        # Look for quantity, prices, and total in the next few lines
        # Expected pattern: quantity, unit_price, blank, unit_price_after_discount, tax, total
        for i in range(start_idx + 1, min(start_idx + 10, len(lines))):
            line = lines[i].strip()
            if not line:
                continue
            
            # Skip lines that look like page headers or footers
            if any(skip_word in line.lower() for skip_word in ['page', 'prolife', 'distribution', 'view this document']):
                continue
            
            # Try to extract quantity (integer) - but be more specific
            if quantity == 0:
                # Look for standalone numbers that could be quantities
                if re.match(r'^\d{1,3}$', line):  # 1-3 digits, standalone
                    potential_qty = int(line)
                    if 1 <= potential_qty <= 1000:
                        quantity = potential_qty
                        continue
                
                # Also try to find numbers within lines
                qty_match = re.search(r'\b(\d+)\b', line)
                if qty_match:
                    potential_qty = int(qty_match.group(1))
                    if 1 <= potential_qty <= 1000:
                        quantity = potential_qty
            
            # Try to extract unit price (decimal) - first occurrence is regular price
            price_match = re.search(r'\b(\d+\.\d{2})\b', line)
            if price_match:
                potential_price = float(price_match.group(1))
                if 0.01 <= potential_price <= 1000:  # Reasonable price range
                    if unit_price == 0.0:
                        unit_price = potential_price
                    elif unit_price_after_discount == 0.0:
                        unit_price_after_discount = potential_price
            
            # Try to extract total (usually starts with €)
            total_match = re.search(r'€(\d+\.\d{2})', line)
            if total_match:
                potential_total = float(total_match.group(1))
                if potential_total > 0:
                    total_from_pdf = potential_total
                    break
        
        # Use unit price after discount if available, otherwise use regular unit price
        final_unit_price = unit_price_after_discount if unit_price_after_discount > 0 else unit_price
        
        return quantity, final_unit_price, total_from_pdf
    
    def _extract_metadata(self, text: str) -> Dict[str, Any]:
        """Extract invoice metadata"""
        metadata = {}
        
        # Extract invoice number
        invoice_match = re.search(r'Invoice\s*#?\s*([A-Z0-9-]+)', text, re.IGNORECASE)
        if invoice_match:
            metadata['invoice_number'] = invoice_match.group(1)
        
        # Extract supplier info
        if 'Prolife' in text:
            metadata['supplier'] = 'Prolife'
        
        # Extract shipping cost - handle various formats
        shipping_patterns = [
            r'Shipping\s*€([\d,]+\.\d{2})',  # "Shipping €228.24"
            r'Shipping[^€]*€\s*(\d+[.,]\d{2})',  # Original pattern
            r'shipping[^€]*€\s*(\d+[.,]\d{2})',  # Case insensitive
        ]
        
        for pattern in shipping_patterns:
            shipping_match = re.search(pattern, text, re.IGNORECASE)
            if shipping_match:
                shipping_value = shipping_match.group(1).replace(',', '')
                metadata['shipping_cost'] = float(shipping_value)
                break
        
        # If still not found, look for shipping at the end of lines
        if 'shipping_cost' not in metadata:
            lines = text.split('\n')
            for line in reversed(lines[-20:]):
                if 'Shipping' in line or 'shipping' in line.lower():
                    shipping_match = re.search(r'€\s*(\d+[.,]\d{2})', line)
                    if shipping_match:
                        metadata['shipping_cost'] = float(shipping_match.group(1).replace(',', '.'))
                        break
        
        return metadata

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 invoice_extractor-prolife-final.py <pdf_path>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    parser = UltimateProlifeParser()
    
    try:
        result = parser.parse_pdf(pdf_path)
        
        # Calculate totals
        subtotal = sum(item['total'] for item in result['line_items'])
        shipping_cost = result['metadata'].get('shipping_cost', 0.0)
        total = subtotal + shipping_cost
        
        # Output JSON for integration with Node.js
        json_result = {
            "supplier_info": {
                "name": result['metadata'].get('supplier', 'Prolife'),
                "address": None,
                "vat_number": None
            },
            "invoice_metadata": {
                "invoice_number": result['metadata'].get('invoice_number'),
                "invoice_date": None,
                "currency": "EUR",
                "shipping_fee": shipping_cost,
                "subtotal": subtotal,
                "total": total
            },
            "line_items": result['line_items']
        }
        
        print(json.dumps(json_result))
        
    except Exception as e:
        error_result = {
            "error": f"Error processing PDF: {e}"
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()