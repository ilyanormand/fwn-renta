import re
from typing import Optional
import datetime

def parse_number(s: str) -> float:
    """
    Parse a number string into a float, handling various formats.
    Examples: "1 234,56", "1.234,56", "1,234.56", "1234.56"
    """
    if not s:
        return 0.0
    
    original_s = s
    # Clean the string
    s = str(s).replace('€', '').replace('EUR', '').replace('$', '').replace('£', '').strip()
    # Remove invisible characters
    s = re.sub(r'[\xa0\u202f\u200b]', '', s)
    # If it's already a clean number, return it
    if re.match(r'^-?\d+(\.\d+)?$', s):
        return float(s)

    # Handle French format: 1 234,56 or 1.234,56
    if ',' in s and '.' in s:
        # Format like 1.234,56
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            # Format like 1,234.56
            s = s.replace(',', '')
    elif ',' in s:
        # Check if it's a decimal separator (,XX) or thousands separator
        parts = s.split(',')
        # If the part after comma has more than 3 digits, it MUST be decimal (e.g. 2,9000)
        # If it has 3 digits, it's ambiguous (1,234), but usually thousands.
        # If it has < 3 digits, it's decimal (1,23).
        if len(parts) == 2 and len(parts[1]) != 3:
             # Decimal separator
            s = s.replace(',', '.')
        else:
            # Thousands separator
            s = s.replace(',', '')
    
    # Remove any remaining non-numeric characters except . and -
    s = re.sub(r'[^\d.-]', '', s)
    
    try:
        val = float(s)
        if val > 100000 and original_s and ',' in original_s and '.' not in original_s:
             # Check if we accidentally stripped the decimal comma
             # e.g. '25 267,18' -> '2526718'
             parts = original_s.split(',')
             if len(parts) == 2 and len(re.sub(r'\D', '', parts[1])) == 2:
                 # Recalculate
                 s2 = original_s.replace(' ', '').replace(',', '.')
                 s2 = re.sub(r'[^\d.-]', '', s2)
                 try:
                     val2 = float(s2)
                     return val2
                 except:
                     pass
        return val
    except ValueError:
        return 0.0

def clean_text(text: str) -> str:
    """Remove extra whitespace and common artifacts."""
    if not text:
        return ""
    text = str(text)
    # Normalize spaces within lines, preserving newlines
    lines = text.split('\n')
    cleaned_lines = [re.sub(r'\s+', ' ', line).strip() for line in lines]
    return '\n'.join(cleaned_lines)

def extract_regex_match(text: str, pattern: str, group: int = 1) -> Optional[str]:
    """Extract a specific group from a regex match."""
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    if match:
        try:
            return match.group(group).strip()
        except IndexError:
            return None
    return None

def normalize_date(date_str: str, language: str = 'en') -> Optional[str]:
    """
    Normalize a date string to ISO 8601 (YYYY-MM-DD).
    Handles common formats and localized month names.
    """
    if not date_str:
        return None
        
    date_str = date_str.lower().strip()
    
    # Month mappings
    months = {
        'en': {
            'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
            'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12',
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        },
        'nl': {
            'januari': '01', 'februari': '02', 'maart': '03', 'april': '04', 'mei': '05', 'juni': '06',
            'juli': '07', 'augustus': '08', 'september': '09', 'oktober': '10', 'november': '11', 'december': '12',
            'okt': '10', 'oktober': '10'
        },
        'fr': {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12',
            'aout': '08', 'fevrier': '02', 'decembre': '12'
        }
    }
    
    # Merge all for fallback or if language specific fails/is not provided
    all_months = {}
    for lang in months:
        all_months.update(months[lang])
    
    # Get relevant map
    month_map = months.get(language, all_months)
    # Also include all_months as fallback
    month_map.update(all_months)

    # Replace month names with numbers
    for name, num in month_map.items():
        if name in date_str:
            date_str = date_str.replace(name, num)
            break
            
    # Clean up non-numeric chars except separators
    date_str = re.sub(r'[^\d\-\/\.]', ' ', date_str)
    date_str = re.sub(r'\s+', ' ', date_str).strip()
    
    # Try parsing
    # Common formats: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, DD.MM.YYYY
    parts = re.split(r'[\-\/\.\s]', date_str)
    
    if len(parts) != 3:
        return None
        
    y, m, d = None, None, None
    
    # Heuristics
    if len(parts[0]) == 4: # YYYY-MM-DD
        y, m, d = parts[0], parts[1], parts[2]
    elif len(parts[2]) == 4: # DD-MM-YYYY
        d, m, y = parts[0], parts[1], parts[2]
    else:
        # Assume DD-MM-YY or YY-MM-DD (ambiguous, default to DD-MM-YY)
        d, m, y = parts[0], parts[1], parts[2]
        if int(y) < 100:
            y = f"20{y}" # Assume 20xx
            
    try:
        # Pad
        m = m.zfill(2)
        d = d.zfill(2)
        return f"{y}-{m}-{d}"
    except Exception:
        return None
