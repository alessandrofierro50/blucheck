"""Valida un XML FatturaPA sull'XSD ufficiale 1.2.2 (copia in docs/xsd). Uso: python3 test/valida_xml.py fattura.xml"""
import sys
from pathlib import Path
from lxml import etree
xsd = etree.XMLSchema(etree.parse(str(Path(__file__).resolve().parent.parent / "docs/xsd/FatturaPA_v1.2.2.xsd")))
doc = etree.parse(sys.argv[1])
if xsd.validate(doc):
    print("XML valido sull'XSD FatturaPA 1.2.2")
else:
    for e in xsd.error_log: print("ERRORE", e.line, e.message)
    sys.exit(1)
