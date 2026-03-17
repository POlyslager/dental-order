-- Update supplier URLs to real product pages where found
-- Run this after seed-products.sql

-- Handschuhe Nitril (P002)
update products set supplier_url = 'https://www.henryschein-dental.de/global/Shopping/ProductDetailsFullPage.aspx?productid=957834&CatalogName=WEBDENT' where article_number = 'P002';

-- Mundschutz FFP2 (P001)
update products set supplier_url = 'https://henryschein-med.de/a/OP-Bedarf/OP-Masken/Monoart+FFP2+Maske+NR+Protection+weiss+10+Stueck/01.6820.18687.1069635' where article_number = 'P001';

-- Flächendesinfektion (I002) — Dürr FD 333
update products set supplier_url = 'https://www.duerrdental.com/produkte/desinfektion/flaechendesinfektion/' where article_number = 'I002';

-- Instrumentenreiniger (R001) — Dürr MD 555
update products set supplier_url = 'https://www.duerrdental.com/produkte/desinfektion/instrumentendesinfektion/' where article_number = 'R001';

-- Ultraschallreiniger-Flüssigkeit (R002) — Dürr ID 220
update products set supplier_url = 'https://www.duerrdental.com/produkte/desinfektion/instrumentendesinfektion/' where article_number = 'R002';

-- Sterilisationsbeutel (S001) — Melag MELAfol
update products set supplier_url = 'https://www.melag.com/en/products/packaging/melafol', producer_url = 'https://www.melag.com/en/products/packaging/melafol' where article_number = 'S001';

-- Kompositfüllung A2 (F001) — Ivoclar Tetric EvoCeram
update products set supplier_url = 'https://www.pluradent.de', producer_url = 'https://www.ivoclar.com/en_us/products/composites/tetric-evoceram' where article_number = 'F001';

-- Glasionomer-Zement (F002) — 3M Ketac Molar
update products set producer_url = 'https://www.3m.com/3M/en_US/p/d/b00034593/' where article_number = 'F002';

-- Lokalanästhetikum Ampullen (AN001) — Ultracain
update products set supplier_url = 'https://www.ultracain.de', producer_url = 'https://www.ultracain.de' where article_number = 'AN001';

-- Topisches Gel (AN002)
update products set producer_url = 'https://www.septodont.co.uk/product/pain-management-scandonest-3-plain/' where article_number = 'AN002';

-- Speichelsauger (V001)
update products set supplier_url = 'https://www.henryschein-dental.de/global/Shopping/ProductDetailsFullPage.aspx?productid=7121179&CatalogName=WEBDENT' where article_number = 'V001';

-- Watterollen (V002)
update products set supplier_url = 'https://www.henryschein-dental.de/global/Shopping/ProductDetailsFullPage.aspx?productid=9001895&CatalogName=WEBDENT' where article_number = 'V002';
