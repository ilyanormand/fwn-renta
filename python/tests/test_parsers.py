import pytest
import sys
import os
import json
from pathlib import Path

# Add parent directory to path to import parsers
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from invoice_extractor_buchteiner import BuchteinerParser

# Define paths to test PDFs
# Assuming PDFs are in the root directory relative to the python script
PROJECT_ROOT = Path(__file__).parent.parent.parent
BUCHTEINER_PDF = PROJECT_ROOT / "Buchteiner.pdf"

class TestParsers:
    def test_buchteiner_parser(self, snapshot):
        if not BUCHTEINER_PDF.exists():
            pytest.skip(f"PDF file not found: {BUCHTEINER_PDF}")
            
        parser = BuchteinerParser(str(BUCHTEINER_PDF))
        result = parser.extract()
        
        # Validate result structure
        assert result['vendor']['name'] == 'Buchteiner'
        assert len(result['order_items']) > 0
        
        # Snapshot test the entire result
        # We exclude volatile data if any (none in this case as date is from PDF)
        assert result == snapshot
