import pytest
from utils import parse_number, parse_date, clean_text

class TestUtils:
    def test_clean_text(self):
        assert clean_text("  hello   world  ") == "hello world"
        assert clean_text("line1\r\nline2") == "line1\nline2"
        assert clean_text(None) == ""

    def test_parse_number_european(self):
        assert parse_number("1.234,56") == 1234.56
        assert parse_number("1.000") == 1000.0
        assert parse_number("0,795") == 0.795
        assert parse_number("123,45") == 123.45

    def test_parse_number_us(self):
        assert parse_number("1,234.56") == 1234.56
        assert parse_number("1,000") == 1000.0
        assert parse_number("123.45") == 123.45

    def test_parse_number_plain(self):
        assert parse_number("1234.56") == 1234.56
        assert parse_number("1234,56") == 1234.56
        assert parse_number("-123.45") == -123.45
        assert parse_number("123.45-") == -123.45

    def test_parse_date(self):
        assert parse_date("30.10.2024") == "2024-10-30"
        assert parse_date("30/10/2024") == "2024-10-30"
        assert parse_date("2024-10-30") == "2024-10-30"
        assert parse_date("invalid") is None
