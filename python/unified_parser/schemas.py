from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any, Union

@dataclass
class VendorConfig:
    name: str
    currency: str = "EUR"
    language: str = "fr"

@dataclass
class HeaderFieldConfig:
    name: str
    regex: str
    group: int = 1
    type: str = "string"  # string, date, number
    target: str = "metadata"  # metadata, customer, vendor

@dataclass
class HeaderConfig:
    fields: List[HeaderFieldConfig]

@dataclass
class ColumnConfig:
    name: str  # standard name: sku, description, quantity, unit_price, total, tax_rate
    index: Optional[int] = None  # For pdfplumber table strategy
    regex_group: Optional[int] = None  # For text regex strategy
    type: str = "string"

@dataclass
class TableConfig:
    strategy: str  # "pdfplumber_table", "text_regex", "text_regex_multiline"
    start_marker: Optional[str] = None
    end_marker: Optional[str] = None
    row_pattern: Optional[str] = None  # For text_regex strategy
    row_pattern_alt: Optional[str] = None  # For text_regex_multiline with dual formats
    columns: List[ColumnConfig] = field(default_factory=list)
    columns_alt: List[ColumnConfig] = field(default_factory=list)  # For alternate pattern
    row_validator_regex: Optional[str] = None
    header_keywords: List[str] = field(default_factory=list) # For identifying table in pdfplumber
    min_columns: int = 0  # Minimum number of columns to process table

@dataclass
class FooterFieldConfig:
    name: str
    regex: str
    group: int = 1
    type: str = "number"

@dataclass
class FooterConfig:
    fields: List[FooterFieldConfig]

@dataclass
class ParserConfig:
    vendor: VendorConfig
    header: HeaderConfig
    table: TableConfig
    footer: FooterConfig
    preprocess: Optional[str] = None  # e.g. "deduplicate"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ParserConfig':
        vendor = VendorConfig(**data.get('vendor', {}))
        
        header_fields = [HeaderFieldConfig(**f) for f in data.get('header', {}).get('fields', [])]
        header = HeaderConfig(fields=header_fields)
        
        table_data = data.get('table', {})
        columns = [ColumnConfig(**c) for c in table_data.get('columns', [])]
        columns_alt = [ColumnConfig(**c) for c in table_data.get('columns_alt', [])]
        table = TableConfig(
            strategy=table_data.get('strategy', 'pdfplumber_table'),
            start_marker=table_data.get('start_marker'),
            end_marker=table_data.get('end_marker'),
            row_pattern=table_data.get('row_pattern'),
            row_pattern_alt=table_data.get('row_pattern_alt'),
            columns=columns,
            columns_alt=columns_alt,
            row_validator_regex=table_data.get('row_validator_regex'),
            header_keywords=table_data.get('header_keywords', []),
            min_columns=table_data.get('min_columns', 0)
        )
        
        footer_fields = [FooterFieldConfig(**f) for f in data.get('footer', {}).get('fields', [])]
        footer = FooterConfig(fields=footer_fields)
        
        return cls(vendor=vendor, header=header, table=table, footer=footer, preprocess=data.get('preprocess'))
