import argparse
import json
import sys
import os
from .schemas import ParserConfig
from .engine import UnifiedInvoiceParser

def load_config(config_path: str) -> ParserConfig:
    with open(config_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return ParserConfig.from_dict(data)

def main():
    parser = argparse.ArgumentParser(description='Unified Invoice Parser')
    parser.add_argument('--config', required=True, help='Path to JSON configuration file')
    parser.add_argument('--pdf', required=True, help='Path to PDF file')
    parser.add_argument('--json', action='store_true', help='Output JSON to stdout')
    
    args = parser.parse_args()
    
    try:
        config = load_config(args.config)
        parser_engine = UnifiedInvoiceParser(args.pdf, config)
        result = parser_engine.extract()
        
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            
    except Exception as e:
        error_data = {"error": str(e)}
        if args.json:
            print(json.dumps(error_data, ensure_ascii=False))
        else:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
