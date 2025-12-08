import json
from python.invoice_extractor_ostrovit import OstrovitInvoiceParser
from python.invoice_extractor_ostrovit2 import OstrovitInvoiceParserV2

def test_ostrovit_pdf_1():
    """Tests the parsing of the first Ostrovit PDF."""
    print("--- Testing /Users/assanali.aukenov/Projects/ShopifyFWNAutomation/Ostrovit.pdf ---")
    parser = OstrovitInvoiceParser()
    data = parser.extract("/Users/assanali.aukenov/Projects/ShopifyFWNAutomation/Ostrovit.pdf")
    print(json.dumps(data, indent=4))

def test_ostrovit_pdf_2():
    """Tests the parsing of the second Ostrovit PDF."""
    print("--- Testing /Users/assanali.aukenov/Projects/ShopifyFWNAutomation/Ostrovit2.pdf ---")
    parser = OstrovitInvoiceParserV2()
    data = parser.extract("/Users/assanali.aukenov/Projects/ShopifyFWNAutomation/Ostrovit2.pdf")
    print(json.dumps(data, indent=4))


if __name__ == "__main__":
    test_ostrovit_pdf_1()
    test_ostrovit_pdf_2()