import re
import datetime
from typing import Optional, Union

def clean_text(text: str) -> str:
    """
    Clean text by removing extra whitespace and normalizing line endings.
    """
    if not text:
        return ""
    # Replace multiple spaces/tabs with single space
    text = re.sub(r'[ \t]+', ' ', text)
    # Normalize line endings
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # Remove leading/trailing whitespace
    return text.strip()

def parse_number(s: str) -> float:
    """
    Robustly parse a number string into a float.
    Handles various formats:
    - 1.234,56 (European: dot thousands, comma decimal)
    - 1,234.56 (US: comma thousands, dot decimal)
    - 1234,56 (Comma decimal)
    - 1234.56 (Dot decimal)
    - 1 234,56 (Space thousands)
    """
    if not s:
        return 0.0
    
    # Remove currency symbols and whitespace
    s = s.replace('€', '').replace('EUR', '').strip()
    # Remove invisible characters
    s = re.sub(r'[\x00-\x1F\x7F]', '', s)
    
    if not s:
        return 0.0

    # Check for negative numbers
    sign = 1
    if s.startswith('-'):
        sign = -1
        s = s[1:]
    elif s.endswith('-'):
        sign = -1
        s = s[:-1]
        
    # Normalize spaces
    s = s.replace(' ', '')
    
    # If no separators, just parse
    if ',' not in s and '.' not in s:
        try:
            return float(s) * sign
        except ValueError:
            return 0.0

    # If both separators are present
    if ',' in s and '.' in s:
        last_comma = s.rfind(',')
        last_dot = s.rfind('.')
        
        if last_comma > last_dot:
            # European format: 1.234,56
            s = s.replace('.', '').replace(',', '.')
        else:
            # US format: 1,234.56
            s = s.replace(',', '')
    elif ',' in s:
        # Only comma
        # Check if it looks like a thousands separator (followed by 3 digits) or decimal
        parts = s.split(',')
        if len(parts) == 2 and len(parts[1]) == 2:
             # Likely decimal: 123,45
             s = s.replace(',', '.')
        elif len(parts) > 1 and all(len(p) == 3 for p in parts[1:]):
             # Likely thousands: 1,000,000 -> 1000000
             # Exception: if starts with 0, it's a decimal: 0,123
             if parts[0] == '0':
                 s = s.replace(',', '.')
             else:
                 s = s.replace(',', '')
        else:
             # Default to decimal separator for comma
             s = s.replace(',', '.')
    
    # If only dot is present
    elif '.' in s:
        # Check if it looks like a thousands separator: 1.000 or 1.234.567
        # But NOT 1.23 (decimal)
        # Regex for dot as thousands: ^\d{1,3}(\.\d{3})+$
        if re.match(r'^-?\d{1,3}(\.\d{3})+$', s):
            s = s.replace('.', '')
    
    # At this point s should be in format 1234.56
    try:
        return float(s) * sign
    except ValueError:
        return 0.0

def parse_date(date_str: str) -> Optional[str]:
    """
    Parse a date string into ISO 8601 format (YYYY-MM-DD).
    Returns None if parsing fails.
    Supported formats:
    - DD.MM.YYYY
    - DD/MM/YYYY
    - DD-MM-YYYY
    - YYYY-MM-DD
    """
    if not date_str:
        return None
        
    date_str = date_str.strip()
    
    # Common separators
    separators = ['.', '/', '-']
    
    for sep in separators:
        if sep in date_str:
            parts = date_str.split(sep)
            if len(parts) != 3:
                continue
                
            p1, p2, p3 = parts
            
            # Try DD.MM.YYYY or DD/MM/YYYY
            if len(p1) <= 2 and len(p2) <= 2 and len(p3) == 4:
                day, month, year = p1, p2, p3
            # Try YYYY-MM-DD
            elif len(p1) == 4 and len(p2) <= 2 and len(p3) <= 2:
                year, month, day = p1, p2, p3
            else:
                continue
                
            try:
                # Validate using datetime
                dt = datetime.date(int(year), int(month), int(day))
                return dt.isoformat()
            except ValueError:
                continue
                
    return None
