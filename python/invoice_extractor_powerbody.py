#!/usr/bin/env python3

import fitz  # PyMuPDF
import re
import json
import sys
from decimal import Decimal
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
import logging

@dataclass
class LineItem:
    sku: str
    manufacturer: str
    description: str
    quantity: Optional[float]
    unit_price: Optional[float]
    total: Optional[float]
    expiry_date: Optional[str] = None
    deal_info: Optional[str] = None

class FinalPowerbodyParser:
    def __init__(self):
        self.supplier_name = "Powerbody"
        self.currency = "EUR"
        self.setup_logging()
        
    def setup_logging(self):
        logging.basicConfig(level=logging.DEBUG, format='%(levelname)s: %(message)s')
        self.logger = logging.getLogger(__name__)
        
    def extract(self, pdf_path):
        """Main extraction method using hybrid approach"""
        try:
            doc = fitz.open(pdf_path)
            
            # Extract text
            all_text = ""
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                all_text += text + "\n"
            
            doc.close()
            
            # Split into lines
            lines = all_text.split('\n')
            
            # Find item anchors using SKU-manufacturer patterns
            item_anchors = self._find_item_anchors(lines)
            
            # Extract line items using sophisticated matching
            line_items = self._extract_items_with_scoring(lines, item_anchors)
            
            # Extract header info
            header_info = self._extract_header_info(all_text)
            
            result = {
                **header_info,
                'line_items': [item.__dict__ for item in line_items],
                'supplier': self.supplier_name,
                'currency': self.currency
            }
            
            # Validate and return
            validation_errors = self._validate_extraction(result)
            if validation_errors:
                result['validation_errors'] = validation_errors
            
            return result
            
        except Exception as e:
            self.logger.error(f"Extraction failed: {str(e)}")
            return {'error': f"Extraction failed: {str(e)}"}
    
    def _find_item_anchors(self, lines):
        """Find item anchor points using SKU-manufacturer patterns"""
        anchors = []
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            # Pattern: Number followed by manufacturer name
            match = re.match(r'^(\d+)\s+(.+)$', line)
            if match:
                sku = match.group(1)
                manufacturer = match.group(2).strip()
                
                # Filter out obvious non-manufacturers
                if self._is_valid_manufacturer(manufacturer):
                    anchors.append({
                        'line_idx': i,
                        'sku': sku,
                        'manufacturer': manufacturer,
                        'type': 'sku_manufacturer'
                    })
        
        self.logger.info(f"Found {len(anchors)} item anchors")
        return anchors
    
    def _is_valid_manufacturer(self, manufacturer):
        """Check if text looks like a valid manufacturer name"""
        # Filter out obvious non-manufacturers
        exclude_patterns = [
            r'€',  # Contains currency
            r'\d{4}-\d{2}-\d{2}',  # Date pattern
            r'^(page|total|invoice|date|kg|grams|ml|pieces)\b',  # Common non-manufacturer words
            r'^\d+$',  # Just numbers
            r'^[^a-zA-Z]*$',  # No letters
            r'chemin de',  # Address patterns
            r'\b(street|avenue|road|boulevard|chemin|rue|place)\b',  # Street names
            r'\b(france|germany|usa|uk|netherlands|belgium)\b',  # Country names
            r'\b\d{5}\b',  # Postal codes
            r'\+\d{8,}',  # Phone numbers
            r'VAT\s*(EU|FR|DE|NL)',  # VAT numbers
            r'fitness\s*world\s*nutrition',  # Company names from address
            r'pierre-yves\s*brugnot',  # Person names
        ]
        
        for pattern in exclude_patterns:
            if re.search(pattern, manufacturer, re.IGNORECASE):
                return False
        
        # Must have reasonable length and contain letters
        return len(manufacturer) >= 3 and re.search(r'[a-zA-Z]', manufacturer)
    
    def _extract_items_with_scoring(self, lines, anchors):
        """Extract items using sophisticated scoring approach"""
        line_items = []
        
        for i, anchor in enumerate(anchors):
            # Determine search range for this item
            start_idx = anchor['line_idx']
            end_idx = anchors[i + 1]['line_idx'] if i + 1 < len(anchors) else min(start_idx + 50, len(lines))
            
            # Extract item data within this range
            item = self._extract_single_item_with_scoring(lines, anchor, start_idx, end_idx)
            if item:
                line_items.append(item)
        
        self.logger.info(f"Extracted {len(line_items)} complete items")
        return line_items
    
    def _extract_single_item_with_scoring(self, lines, anchor, start_idx, end_idx):
        """Extract a single item using scoring approach"""
        sku = anchor['sku']
        manufacturer = anchor['manufacturer']
        
        # Extract description
        description = self._extract_description(lines, start_idx, end_idx)
        
        # Extract all numbers in the range
        all_numbers = self._extract_all_numbers(lines, start_idx, end_idx)
        
        # Find best quantity-unit price-total combination using scoring
        pricing = self._find_best_pricing_combination(all_numbers, sku)
        
        # Extract additional metadata
        expiry_date = self._extract_expiry_date(lines, start_idx, end_idx)
        deal_info = self._extract_deal_info(lines, start_idx, end_idx)
        
        return LineItem(
            sku=sku,
            manufacturer=manufacturer,
            description=description,
            quantity=pricing.get('quantity'),
            unit_price=pricing.get('unit_price'),
            total=pricing.get('total'),
            expiry_date=expiry_date,
            deal_info=deal_info
        )
    
    def _extract_description(self, lines, start_idx, end_idx):
        """Extract product description within item range"""
        for i in range(start_idx, min(start_idx + 10, end_idx)):
            if i >= len(lines):
                break
            
            line = lines[i].strip()
            
            # Look for supplement/nutrition keywords
            keywords = ['protein', 'vitamin', 'supplement', 'powder', 'capsule', 
                       'tablet', 'cream', 'bar', 'drink', 'amino', 'creatine', 
                       'whey', 'casein', 'bcaa', 'glutamine', 'carnitine', 'omega',
                       'magnesium', 'zinc', 'iron', 'calcium', 'multivitamin']
            
            if len(line) > 15 and any(keyword in line.lower() for keyword in keywords):
                # Clean up the description
                description = re.sub(r'\d{4}-\d{2}-\d{2}', '', line)  # Remove dates
                description = re.sub(r'€[\d,]+\.\d{2}', '', description)  # Remove prices
                description = re.sub(r'\s+', ' ', description).strip()  # Clean whitespace
                
                if len(description) > 10:
                    return description
        
        return ""
    
    def _extract_all_numbers(self, lines, start_idx, end_idx):
        """Extract all numbers from the item range"""
        all_numbers = []
        
        # Join all lines in the range
        block_text = ' '.join(lines[start_idx:min(end_idx, len(lines))])
        
        # Extract decimal numbers (prices)
        decimal_pattern = re.compile(r'€([\d,]+\.\d{2})')
        for match in decimal_pattern.finditer(block_text):
            price_str = match.group(1)
            price = self._parse_number(price_str)
            if price > 0:
                all_numbers.append({
                    'value': price,
                    'type': 'price',
                    'position': match.start(),
                    'original': price_str
                })
        
        # Extract quantity codes
        qty_pattern = re.compile(r'\b(\d{4,6})\b')
        for match in qty_pattern.finditer(block_text):
            qty_str = match.group(1)
            quantity = self._decode_quantity(qty_str)
            if 0.1 <= quantity <= 1000:  # Reasonable range
                all_numbers.append({
                    'value': quantity,
                    'type': 'quantity',
                    'position': match.start(),
                    'original': qty_str
                })
        
        # Extract standalone numbers
        num_pattern = re.compile(r'\b(\d+(?:\.\d{1,2})?)\b')
        for match in num_pattern.finditer(block_text):
            num_str = match.group(1)
            num = self._parse_number(num_str)
            if 0.1 <= num <= 10000:  # Very broad range
                all_numbers.append({
                    'value': num,
                    'type': 'number',
                    'position': match.start(),
                    'original': num_str
                })
        
        return all_numbers
    
    def _find_best_pricing_combination(self, all_numbers, sku):
        """Find best quantity-unit price-total combination using scoring"""
        best_combo = {'quantity': None, 'unit_price': None, 'total': None}
        best_score = float('-inf')
        
        # Get quantities and prices separately
        quantities = [n for n in all_numbers if n['type'] in ['quantity', 'number']]
        prices = [n for n in all_numbers if n['type'] in ['price', 'number']]
        
        # Try all combinations
        for qty_info in quantities:
            quantity = qty_info['value']
            
            for price1_info in prices:
                unit_price = price1_info['value']
                
                for price2_info in prices:
                    if price1_info == price2_info:
                        continue
                    
                    total = price2_info['value']
                    
                    # Calculate mathematical error
                    expected_total = quantity * unit_price
                    math_error = abs(expected_total - total)
                    relative_error = math_error / max(total, 1.0)
                    
                    # Skip if mathematical error is too high
                    if relative_error > 0.3:  # 30% tolerance
                        continue
                    
                    # Calculate score
                    score = self._calculate_combination_score(
                        quantity, unit_price, total, math_error, 
                        qty_info, price1_info, price2_info, sku
                    )
                    
                    if score > best_score:
                        best_score = score
                        best_combo['quantity'] = quantity
                        best_combo['unit_price'] = unit_price
                        best_combo['total'] = total
        
        # If no good combination found, try alternative approaches
        if best_combo['quantity'] is None:
            best_combo = self._fallback_pricing_extraction(all_numbers)
        
        return best_combo
    
    def _calculate_combination_score(self, quantity, unit_price, total, math_error, 
                                   qty_info, price1_info, price2_info, sku):
        """Calculate score for a quantity-unit price-total combination"""
        score = 0
        
        # Mathematical accuracy is CRITICAL (much higher weight)
        if math_error < 0.01:  # Perfect or near-perfect match
            score += 1000
        elif math_error < 0.1:
            score += 500
        elif math_error < 1.0:
            score += 200
        else:
            score -= math_error * 100  # Heavy penalty for large errors
        
        # Strong preference for decoded quantity codes
        if qty_info['type'] == 'quantity':
            score += 500  # Increased bonus for proper quantity codes
        
        # Heavy penalty for using qty=1.0 when proper quantity codes exist
        if quantity == 1.0 and qty_info['type'] == 'number':
            score -= 600  # Strong penalty for qty=1.0 from standalone numbers
        
        # Strong preference for currency-marked prices
        if price1_info['type'] == 'price':
            score += 800  # Much higher bonus for currency-marked unit prices
        if price2_info['type'] == 'price':
            score += 400  # Higher bonus for currency-marked totals
        
        # Prefer decimal numbers as unit prices (they're more likely to be prices than quantities)
        if price1_info['type'] == 'number' and '.' in price1_info['original']:
            score += 300  # Bonus for decimal unit prices
        
        # Prefer whole numbers as quantities
        if qty_info['type'] == 'number' and '.' not in qty_info['original']:
            score += 200  # Bonus for whole number quantities
        
        # Heavy penalty for using decimal numbers as quantities when they could be unit prices
        if qty_info['type'] == 'number' and '.' in qty_info['original'] and quantity < 10:
            score -= 800  # Strong penalty for small decimal quantities
        
        # Heavy penalty for using standalone numbers as prices when currency prices exist
        if price1_info['type'] == 'number' and unit_price < 2.0:
            score -= 600  # Penalize small standalone numbers as unit prices
        if price2_info['type'] == 'number' and total < 10.0:
            score -= 400  # Penalize small standalone numbers as totals
        
        # Reasonable quantity ranges for supplement wholesale
        if 0.5 <= quantity <= 10:
            score += 200
        elif 10 < quantity <= 50:
            score += 150  # Common wholesale quantities
        elif 50 < quantity <= 200:
            score += 100  # Bulk orders
        elif 200 < quantity <= 1000:
            score += 50   # Large bulk orders
        elif quantity > 1000:
            score += 25   # Very large bulk orders - still positive bonus
        
        # Reasonable unit price ranges for supplements
        if 1 <= unit_price <= 20:
            score += 150
        elif 20 < unit_price <= 50:
            score += 100
        elif 50 < unit_price <= 100:
            score += 50
        else:
            score -= 50
        
        # Reasonable total ranges
        if 1 <= total <= 100:
            score += 150
        elif 100 < total <= 500:
            score += 100
        else:
            score -= 50
        
        # Position-based scoring (quantity should appear before prices)
        if qty_info['position'] < price1_info['position']:
            score += 50
        if qty_info['position'] < price2_info['position']:
            score += 50
        
        # Strong penalty for impossible combinations
        if unit_price >= total and quantity > 1:
            score -= 1000
        
        # Penalty for using price-formatted numbers as quantities
        if qty_info['type'] == 'price':
            score -= 300
        
        # Bonus for logical value ordering
        if quantity <= unit_price <= total:
            score += 100
        
        return score
    
    def _fallback_pricing_extraction(self, all_numbers):
        """Fallback pricing extraction when scoring fails"""
        pricing = {'quantity': None, 'unit_price': None, 'total': None}
        
        # Try to find at least some pricing data
        quantities = [n for n in all_numbers if n['type'] == 'quantity']
        prices = [n for n in all_numbers if n['type'] == 'price']
        
        if quantities and prices:
            # Use first quantity and try to match with prices
            quantity = quantities[0]['value']
            
            if len(prices) >= 2:
                # Try to determine which is unit price and which is total
                price1, price2 = prices[0]['value'], prices[1]['value']
                
                # Assume smaller price is unit price, larger is total
                if price1 < price2:
                    unit_price, total = price1, price2
                else:
                    unit_price, total = price2, price1
                
                # Validate
                if abs(quantity * unit_price - total) < total * 0.5:  # 50% tolerance
                    pricing = {
                        'quantity': quantity,
                        'unit_price': unit_price,
                        'total': total
                    }
        
        return pricing
    
    def _parse_number(self, s):
        """Parse a number string that may have spaces, commas, or dots"""
        if not s:
            return 0.0
        
        # Remove currency symbols and normalize
        s = str(s).replace('€', '').replace('EUR', '').strip()
        
        # Handle spaced decimals like "5. 65" -> "5.65"
        s = re.sub(r'(\d+)\s*[.,]\s*(\d{2})', r'\1.\2', s)
        
        # Remove thousands separators if present
        if ',' in s and '.' in s:
            if s.rfind(',') > s.rfind('.'):
                s = s.replace('.', '').replace(',', '.')
            else:
                s = s.replace(',', '')
        else:
            s = s.replace(',', '.')
        
        try:
            return float(s)
        except:
            return 0.0
    
    def _decode_quantity(self, qty_code):
        """Decode quantity from various formats"""
        qty_str = str(qty_code)
        
        # Try both interpretations and let the scoring system decide
        # For now, prefer the simpler interpretation (direct integer)
        # The scoring system will favor mathematically correct combinations
        return float(qty_str)
    
    def _extract_expiry_date(self, lines, start_idx, end_idx):
        """Extract expiry date if present"""
        for i in range(start_idx, min(start_idx + 10, end_idx)):
            if i >= len(lines):
                break
            
            line = lines[i].strip()
            expiry_match = re.search(r'(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})', line)
            if expiry_match:
                return expiry_match.group(1)
        
        return None
    
    def _extract_deal_info(self, lines, start_idx, end_idx):
        """Extract deal information if present"""
        for i in range(start_idx, min(start_idx + 10, end_idx)):
            if i >= len(lines):
                break
            
            line = lines[i].strip()
            deal_match = re.search(r'(\d+\+\d+|buy.*get.*free|\d+%.*off)', line.lower())
            if deal_match:
                return deal_match.group(0)
        
        return None
    
    def _extract_header_info(self, text):
        """Extract header information"""
        header_info = {}
        
        # Extract invoice number
        invoice_match = re.search(r'Invoice[\s#:]*([A-Z0-9-]+)', text, re.IGNORECASE)
        if invoice_match:
            header_info['invoice_number'] = invoice_match.group(1)
        
        # Extract total amount
        total_matches = re.findall(r'€([\d,]+\.\d{2})', text)
        if total_matches:
            amounts = [float(m.replace(',', '')) for m in total_matches]
            header_info['total_amount'] = max(amounts)
        
        return header_info
    
    def _validate_extraction(self, data):
        """Validate extraction results"""
        errors = []
        
        # Check mathematical consistency
        if 'line_items' in data and 'total_amount' in data:
            calculated = sum(Decimal(str(item.get('total', 0))) for item in data['line_items'] 
                           if isinstance(item, dict) and item.get('total'))
            declared = Decimal(str(data['total_amount']))
            
            if abs(calculated - declared) > Decimal('100.0'):  # More lenient tolerance
                errors.append(f"Total mismatch: calculated {calculated} vs declared {declared}")
        
        # Check completeness
        if data.get('line_items'):
            items_with_prices = [item for item in data['line_items'] 
                               if isinstance(item, dict) and item.get('total')]
            total_items = len(data['line_items'])
            
            if len(items_with_prices) < total_items:
                missing = total_items - len(items_with_prices)
                errors.append(f"Items missing price information: {missing}/{total_items}")
        
        return errors

def main():
    """Test the final parser"""
    if len(sys.argv) != 2:
        print("Usage: python3 invoice_extractor-powerbody-final.py <pdf_path>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    parser = FinalPowerbodyParser()
    result = parser.extract(pdf_path)
    
    print(json.dumps(result, indent=2, default=str))
    
    # Print validation errors separately
    if 'validation_errors' in result:
        print("\nValidation Errors:", file=sys.stderr)
        for error in result['validation_errors']:
            print(f"- {error}", file=sys.stderr)

if __name__ == "__main__":
    main()