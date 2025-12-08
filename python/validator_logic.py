from typing import Dict, Any, List, Optional
import math

class InvoiceValidator:
    """
    Validates the structure and content of parsed invoice data.
    """
    
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.errors = []
        self.warnings = []

    def validate(self) -> Dict[str, Any]:
        """
        Run all validation checks.
        Returns a dict with 'valid' (bool), 'errors' (list), 'warnings' (list).
        """
        self.errors = []
        self.warnings = []
        
        self._check_structure()
        if not self.errors:  # Only proceed if basic structure is there
            self._check_required_fields()
            self._check_data_types()
            self._check_mathematics()
            
        return {
            "valid": len(self.errors) == 0,
            "errors": self.errors,
            "warnings": self.warnings
        }

    def _check_structure(self):
        """Check if top-level keys exist"""
        required_keys = ['vendor', 'customer', 'order_items', 'totals', 'metadata']
        for key in required_keys:
            if key not in self.data:
                self.errors.append(f"Missing top-level key: {key}")

    def _check_required_fields(self):
        """Check for essential business data"""
        # Vendor
        if not self.data.get('vendor', {}).get('name'):
            self.errors.append("Vendor name is missing")
            
        # Metadata
        meta = self.data.get('metadata', {})
        if not meta.get('invoice_number'):
            self.errors.append("Invoice number is missing")
        if not meta.get('invoice_date'):
            self.errors.append("Invoice date is missing")
            
        # Items
        items = self.data.get('order_items', [])
        if not items:
            self.warnings.append("No order items found")

    def _check_data_types(self):
        """Verify data types of fields"""
        # Check items
        for idx, item in enumerate(self.data.get('order_items', [])):
            # Quantity should be numeric
            try:
                float(item.get('quantity', 0))
            except (ValueError, TypeError):
                self.errors.append(f"Item {idx+1}: Quantity '{item.get('quantity')}' is not a valid number")
                
            # Prices should be numeric
            try:
                float(item.get('unit_price', 0))
            except (ValueError, TypeError):
                self.errors.append(f"Item {idx+1}: Unit price '{item.get('unit_price')}' is not a valid number")
                
            try:
                float(item.get('total', 0))
            except (ValueError, TypeError):
                self.errors.append(f"Item {idx+1}: Total '{item.get('total')}' is not a valid number")

    def _check_mathematics(self):
        """Verify mathematical consistency"""
        items = self.data.get('order_items', [])
        totals = self.data.get('totals', {})
        
        if not items:
            return

        # 1. Check Line Item Totals (Qty * Unit Price == Total)
        for idx, item in enumerate(items):
            try:
                qty = float(item.get('quantity', 0))
                price = float(item.get('unit_price', 0))
                line_total = float(item.get('total', 0))
                
                calculated = qty * price
                # Allow 0.02 difference for rounding
                if abs(calculated - line_total) > 0.05:
                    # Sometimes unit price is rounded in display, so this is a warning
                    self.warnings.append(f"Item {idx+1}: Calculated total ({calculated:.2f}) differs from declared ({line_total})")
            except (ValueError, TypeError):
                pass

        # 2. Check Subtotal (Sum of Line Items == Subtotal)
        try:
            items_sum = sum(float(item.get('total', 0)) for item in items)
            
            # Try to get subtotal, fallback to total if not present
            declared_subtotal_str = totals.get('subtotal')
            if not declared_subtotal_str:
                declared_subtotal_str = totals.get('total')
                
            if declared_subtotal_str:
                declared_subtotal = float(declared_subtotal_str)
                
                # Check 1: Sum of items == Subtotal
                diff_items = abs(items_sum - declared_subtotal)
                
                # Check 2: Sum of items + Shipping == Subtotal
                shipping = float(totals.get('shipping_fee', 0) or 0)
                diff_with_shipping = abs((items_sum + shipping) - declared_subtotal)
                
                if diff_items > 0.5 and diff_with_shipping > 0.5:
                     self.errors.append(f"Sum of items ({items_sum:.2f}) [+ Shipping ({shipping:.2f})] does not match declared subtotal ({declared_subtotal:.2f})")
        except (ValueError, TypeError):
            pass
