from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
import json
import sys
import os

class BaseInvoiceParser(ABC):
    """
    Abstract base class for invoice parsers.
    Enforces a standard interface and output structure.
    """
    
    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self.data = {
            'vendor': {},
            'customer': {},
            'order_items': [],
            'totals': {},
            'metadata': {}
        }
        self.raw_text = ""
        
    @abstractmethod
    def extract(self) -> Dict[str, Any]:
        """
        Main method to extract data from the PDF.
        Should return the standardized dictionary.
        """
        pass
    
    def validate(self) -> List[str]:
        """
        Validate the extracted data.
        Returns a list of error messages (empty if valid).
        """
        errors = []
        
        # Check required fields
        if not self.data['vendor'].get('name'):
            errors.append("Vendor name is missing")
            
        if not self.data['metadata'].get('invoice_number'):
            errors.append("Invoice number is missing")
            
        if not self.data['metadata'].get('invoice_date'):
            errors.append("Invoice date is missing")
            
        # Check totals consistency
        items = self.data.get('order_items', [])
        if items:
            try:
                calculated_total = sum(float(item.get('total', 0)) for item in items)
                declared_total = float(self.data['totals'].get('subtotal', 0) or self.data['totals'].get('total', 0))
                
                # Allow for small rounding differences (e.g. 0.05)
                if abs(calculated_total - declared_total) > 0.1:
                    # This is a warning, not a hard error for now, as tax handling varies
                    pass 
            except (ValueError, TypeError):
                pass
                
        return errors

    def to_json(self) -> str:
        """Return data as JSON string"""
        return json.dumps(self.data, ensure_ascii=False, indent=2)

    def run(self, json_output: bool = False):
        """
        Execute the parsing and print result.
        Used by the main block of the script.
        """
        try:
            result = self.extract()
            errors = self.validate()
            
            if errors:
                result['validation_errors'] = errors
                
            if json_output:
                print(json.dumps(result, ensure_ascii=False))
            else:
                print(json.dumps(result, ensure_ascii=False, indent=2))
                
        except Exception as e:
            error_data = {"error": str(e)}
            if json_output:
                print(json.dumps(error_data, ensure_ascii=False))
            else:
                print(f"Error: {e}", file=sys.stderr)
