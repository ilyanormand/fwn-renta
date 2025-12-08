import json
from unified_parser.engine import UnifiedInvoiceParser
from unified_parser.schemas import ParserConfig

def get_config():
    with open('python/configs/labz.json', 'r') as f:
        config_data = json.load(f)
    return ParserConfig.from_dict(config_data)

filepath = "python/test_invoices/LABZ/facture_59224 (1).pdf"
config = get_config()
parser = UnifiedInvoiceParser(filepath, config)
data = parser.extract()

print(json.dumps(data, indent=2))
