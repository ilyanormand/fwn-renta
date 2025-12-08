"""
Unified Invoice Parser

A configuration-driven invoice parser engine for multiple suppliers.
"""

__version__ = "1.0.0"

from .engine import UnifiedInvoiceParser
from .schemas import ParserConfig

__all__ = ["UnifiedInvoiceParser", "ParserConfig"]
