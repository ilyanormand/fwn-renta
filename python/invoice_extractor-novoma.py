import re
import json
import io
import re
import xml.etree.ElementTree as ET
from decimal import Decimal
from typing import List, Dict, Any, Optional

from pdfminer.high_level import extract_text_to_fp, extract_text
from pdfminer.layout import LAParams


class NovomaInvoiceParser:
    """Parser for Novoma invoices that embed a Factur-X/CII XML attachment inside the PDF.

    This implementation attempts to locate the XML payload in the PDF binary first – this is
    the most reliable way to get structured data because the XML is machine-readable and
    guarantees mathematically consistent totals. Falling back to a plain-text strategy is
    possible but is *not* implemented yet because Novoma documents inspected so far always
    contain the XML attachment.
    """

    XML_PATTERN = re.compile(
        rb"<rsm:CrossIndustryInvoice[\s\S]+?</rsm:CrossIndustryInvoice>", re.MULTILINE
    )

    def __init__(self) -> None:
        self.supplier_name = "Novoma"
        self.currency = "EUR"

    # ---------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------
    def extract(self, pdf_path: str) -> Dict[str, Any]:
        """Main extraction method with top-level validation and error handling."""
        try:
            xml_root = self._extract_embedded_xml(pdf_path)
            if xml_root is None:
                raise RuntimeError("Unable to locate embedded Factur-X XML in the document")

            header_info = self._extract_header_info(xml_root)
            line_items = self._extract_line_items(xml_root)

            result: Dict[str, Any] = {
                **header_info,
                "line_items": line_items,
                "supplier": self.supplier_name,
                "currency": self.currency,
            }

            validation_errors = self._validate_extraction(result)
            if validation_errors:
                result["validation_errors"] = validation_errors

            return result
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Extraction failed: {exc}"}

    # ------------------------------------------------------------------
    # Private helpers – XML extraction
    # ------------------------------------------------------------------
    def _extract_embedded_xml(self, pdf_path: str) -> Optional[ET.Element]:
        """Return root Element of the embedded Factur-X XML, if found."""
        with open(pdf_path, "rb") as fp:
            pdf_bytes = fp.read()

        xml_match = self.XML_PATTERN.search(pdf_bytes)
        if not xml_match:
            return None

        xml_bytes = xml_match.group(0)
        try:
            # The XML is declared as UTF-8 in all samples inspected.
            xml_str = xml_bytes.decode("utf-8", errors="replace")
            return ET.fromstring(xml_str)
        except ET.ParseError:
            return None

    # ------------------------------------------------------------------
    # Extraction helpers – Header / line items
    # ------------------------------------------------------------------
    def _ns(self, tag: str) -> str:  # noqa: D401
        """Helper to shorten namespace lookups."""
        return f"{{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}}{tag}"

    def _extract_header_info(self, root: ET.Element) -> Dict[str, Any]:
        header: Dict[str, Any] = {}

        # Navigate to the <rsm:ExchangedDocument> node
        ns_rsm = "{urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100}"
        ns_ram = "{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}"
        ns_udt = "{urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100}"

        doc_node = root.find(f"{ns_rsm}ExchangedDocument")
        if doc_node is not None:
            invoice_id_el = doc_node.find(f"{ns_ram}ID")
            if invoice_id_el is not None and invoice_id_el.text:
                header["invoice_number"] = invoice_id_el.text.strip()

            issue_dt_el = doc_node.find(f"{ns_ram}IssueDateTime/{ns_udt}DateTimeString")
            if issue_dt_el is not None and issue_dt_el.text:
                # The date is YYYYMMDD (format 102)
                val = issue_dt_el.text.strip()
                if re.match(r"^\d{8}$", val):
                    header["invoice_date"] = f"{val[0:4]}-{val[4:6]}-{val[6:8]}"

        # Totals live under ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation
        settlement_node = root.find(
            f".//{ns_ram}ApplicableHeaderTradeSettlement/{ns_ram}SpecifiedTradeSettlementHeaderMonetarySummation"
        )
        if settlement_node is not None:
            total_amount_el = settlement_node.find(f"{ns_ram}GrandTotalAmount")
            if total_amount_el is not None and total_amount_el.text:
                header["total_amount"] = float(total_amount_el.text.strip())
            
            # Extract tax total amount
            tax_total_el = settlement_node.find(f"{ns_ram}TaxTotalAmount")
            if tax_total_el is not None and tax_total_el.text:
                header["tax_total"] = float(tax_total_el.text.strip())
            
            # Extract subtotal (line items total before tax)
            subtotal_el = settlement_node.find(f"{ns_ram}LineTotalAmount")
            if subtotal_el is not None and subtotal_el.text:
                header["subtotal"] = float(subtotal_el.text.strip())

        return header

    def _extract_line_items(self, root: ET.Element) -> List[Dict[str, Any]]:
        ns_ram = "{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}"

        items: List[Dict[str, Any]] = []
        for item_el in root.findall(f".//{ns_ram}IncludedSupplyChainTradeLineItem"):
            try:
                sku_el = item_el.find(f"{ns_ram}SpecifiedTradeProduct/{ns_ram}SellerAssignedID")
                name_el = item_el.find(f"{ns_ram}SpecifiedTradeProduct/{ns_ram}Name")
                qty_el = item_el.find(f"{ns_ram}SpecifiedLineTradeDelivery/{ns_ram}BilledQuantity")
                unit_price_el = item_el.find(
                    f"{ns_ram}SpecifiedLineTradeAgreement/{ns_ram}NetPriceProductTradePrice/{ns_ram}ChargeAmount"
                )
                total_el = item_el.find(
                    f"{ns_ram}SpecifiedLineTradeSettlement/{ns_ram}SpecifiedTradeSettlementLineMonetarySummation/{ns_ram}LineTotalAmount"
                )
                vat_el = item_el.find(
                    f"{ns_ram}SpecifiedLineTradeSettlement/{ns_ram}ApplicableTradeTax/{ns_ram}RateApplicablePercent"
                )

                if not (sku_el is not None and name_el is not None and qty_el is not None and unit_price_el is not None and total_el is not None):
                    # Skip malformed entries - debug what's missing
                    print(f"Skipping item - missing elements: sku={sku_el is not None}, name={name_el is not None}, qty={qty_el is not None}, unit_price={unit_price_el is not None}, total={total_el is not None}")
                    continue

                # Quantity may be decimal with unitCode attr -> convert to int/float
                qty_raw = qty_el.text.strip()
                quantity: float = float(qty_raw)
                # Decide int or float depending on .0
                if quantity.is_integer():
                    quantity = int(quantity)

                unit_price = float(unit_price_el.text.strip())
                total_price = float(total_el.text.strip())
                
                # Apply VAT to unit price if VAT rate is available
                if vat_el is not None and vat_el.text:
                    vat_rate = float(vat_el.text.strip())
                    # Convert from HT to TTC (apply VAT)
                    unit_price = round(unit_price * (1 + vat_rate / 100), 2)
                
                # Calculate total from VAT-inclusive unit price and quantity
                calculated_total = round(unit_price * quantity, 2)

                items.append(
                    {
                        "sku": sku_el.text.strip(),
                        "description": name_el.text.strip(),
                        "quantity": quantity,
                        "unit_price": round(unit_price, 2),
                        "total": calculated_total,
                    }
                )
            except Exception:
                # Skip problematic items but continue parsing others
                continue

        return items

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------
    def _validate_extraction(self, data: Dict[str, Any]) -> List[str]:
        errors: List[str] = []

        # Total consistency
        if "line_items" in data and "total_amount" in data:
            # Since unit prices now include VAT, calculate total from VAT-inclusive prices
            calculated = sum(
                Decimal(str(item.get("quantity", 0))) * Decimal(str(item.get("unit_price", 0)))
                for item in data["line_items"]
            )
            declared = Decimal(str(data["total_amount"]))
            
            print(f"Debug: Calculated total (qty × VAT-inclusive unit price): {calculated}")
            print(f"Debug: Declared total: {declared}")
            
            # Allow for small rounding differences (1.00 to account for cumulative rounding in VAT calculations)
            if abs(calculated - declared) > Decimal("1.00"):
                errors.append(
                    f"Total mismatch: calculated {calculated} vs declared {declared}"
                )

        # Required fields
        for field in ["invoice_number", "invoice_date", "line_items"]:
            if not data.get(field):
                errors.append(f"Missing required field: {field}")

        # Line-item checks
        for idx, item in enumerate(data.get("line_items", []), start=1):
            if not item.get("sku"):
                errors.append(f"Line {idx}: missing SKU")
            if not item.get("description"):
                errors.append(f"Line {idx}: missing description")
            if item.get("quantity", 0) <= 0:
                errors.append(f"Line {idx}: invalid quantity")
            if item.get("total", 0) <= 0:
                errors.append(f"Line {idx}: invalid total")

        return errors


# ----------------------------------------------------------------------
# CLI utility for quick testing
# ----------------------------------------------------------------------

def _test(pdf_path: str) -> None:  # pragma: no cover
    parser = NovomaInvoiceParser()
    result = parser.extract(pdf_path)
    print("=== NOVOMA INVOICE EXTRACTION ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if "validation_errors" in result:
        print("\n=== VALIDATION ERRORS ===")
        for err in result["validation_errors"]:
            print(f"- {err}")


if __name__ == "__main__":  # pragma: no cover
    import sys

    if len(sys.argv) < 2:
        print("Usage: python invoice_extractor-novoma.py <PDF_PATH>")
    else:
        _test(sys.argv[1])