-- Clear existing products and insert 50 real dental products
-- across existing categories with real supplier websites

delete from stock_movements;
delete from order_items;
delete from products;

insert into products (article_number, name, description, category, current_stock, min_stock, unit, preferred_supplier, supplier_url, producer_url, last_price, expiry_date, storage_location, reorder_quantity) values

-- Abformmaterialien (6)
('A001', 'Alginat Cavex CA37', 'Schnellabformmasse für Situationsmodelle, 500g', 'Abformmaterialien', 4, 5, 'Beutel', 'Pluradent', 'https://www.pluradent.de', 'https://www.cavex.nl', 18.90, '2026-06-01', 'Behandlungsraum 1', 5),
('A002', 'Silagum Light Body', 'A-Silikon dünnfließend für Präzisionsabformungen', 'Abformmaterialien', 6, 3, 'Kartusche', 'Henry Schein', 'https://www.henryschein.de', 'https://www.dmg-dental.com', 34.50, '2026-09-01', 'Behandlungsraum 1', 4),
('A003', 'Silagum Heavy Body', 'A-Silikon schwerfließend als Löffelm.', 'Abformmaterialien', 3, 3, 'Kartusche', 'Henry Schein', 'https://www.henryschein.de', 'https://www.dmg-dental.com', 32.00, '2026-09-01', 'Behandlungsraum 1', 4),
('A004', 'Impregum Penta Soft', 'Polyether Abformmaterial, mittelviskös', 'Abformmaterialien', 2, 2, 'Kartusche', 'Pluradent', 'https://www.pluradent.de', 'https://www.3m.com', 48.00, '2026-12-01', 'Behandlungsraum 2', 3),
('A005', 'Abformlöffel OK Gr. 3', 'Kunststofflöffel Oberkiefer perforiert', 'Abformmaterialien', 12, 5, 'Pack', 'Henry Schein', 'https://www.henryschein.de', null, 8.50, null, 'Behandlungsraum 1', 10),
('A006', 'Abformlöffel UK Gr. 3', 'Kunststofflöffel Unterkiefer perforiert', 'Abformmaterialien', 10, 5, 'Pack', 'Henry Schein', 'https://www.henryschein.de', null, 8.50, null, 'Behandlungsraum 1', 10),

-- Anästhetika (5)
('AN001', 'Ultracain DS forte Carpulen', 'Articain 4% + Epinephrin 1:100.000, 50 St.', 'Anästhetika', 3, 3, 'Packung', 'Pluradent', 'https://www.pluradent.de', 'https://www.septodont.de', 54.00, '2026-03-01', 'Steri', 3),
('AN002', 'Scandonest 3% plain', 'Mepivacain ohne Vasokonstriktor, 50 St.', 'Anästhetika', 5, 2, 'Packung', 'Pluradent', 'https://www.pluradent.de', 'https://www.septodont.de', 48.00, '2026-06-01', 'Steri', 3),
('AN003', 'Topex Gel Kirsche', 'Oberflächenanästhetikum 20% Benzocain, 60g', 'Anästhetika', 2, 2, 'Tube', 'Henry Schein', 'https://www.henryschein.de', null, 12.90, '2026-01-01', 'Steri', 3),
('AN004', 'Kanülen 0.4x35mm kurz', 'Einmalkanülen für Carpulenspritzen, 100 St.', 'Anästhetika', 4, 3, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 16.50, null, 'Steri', 5),
('AN005', 'Carpulenspritze Ubject', 'Aspirationsspritze für 1.7ml Carpulen', 'Anästhetika', 3, 1, 'Stück', 'Pluradent', 'https://www.pluradent.de', null, 28.00, null, 'Steri', 2),

-- Ausrüstung (4)
('E001', 'Polymerisationslampe Demi Ultra', 'LED Lampe 1200mW/cm², mit Ladegerät', 'Ausrüstung', 2, 1, 'Stück', 'Henry Schein', 'https://www.henryschein.de', 'https://www.kerrdental.com', 320.00, null, 'Behandlungsraum 3', 1),
('E002', 'Scaler-Ansatz ProScaler', 'Ultraschall-Ansatzstück kompatibel EMS', 'Ausrüstung', 3, 2, 'Stück', 'Pluradent', 'https://www.pluradent.de', null, 45.00, null, 'Steri', 3),
('E003', 'Amalgamator Ultramat 2', 'Kapselanmischgerät mit Timer', 'Ausrüstung', 1, 1, 'Stück', 'Henry Schein', 'https://www.henryschein.de', 'https://www.sdidental.com', 185.00, null, 'Behandlungsraum 2', 1),
('E004', 'Intraoral-Kamera CamX Triton', 'USB Intraorale Kamera', 'Ausrüstung', 1, 1, 'Stück', 'Henry Schein', 'https://www.henryschein.de', null, 490.00, null, 'Rezeption', 1),

-- Bildgebende Materialien (3)
('B001', 'RINN XCP Bissflügelhalter Set', 'Filmhalter-Set für Biss-Flügel-Aufnahmen', 'Bildgebende Materialien', 2, 1, 'Set', 'Henry Schein', 'https://www.henryschein.de', 'https://www.dentsplysirona.com', 68.00, null, 'Radiologie', 2),
('B002', 'Bleischürze Erwachsene', 'Strahlenschutzschürze 0.5mm Pb-Äquivalent', 'Bildgebende Materialien', 2, 2, 'Stück', 'Pluradent', 'https://www.pluradent.de', null, 195.00, null, 'Radiologie', 1),
('B003', 'Phosphorplatte Gr. 2 (5er)', 'Speicherfolie für digitales Röntgen', 'Bildgebende Materialien', 3, 2, 'Pack', 'Henry Schein', 'https://www.henryschein.de', 'https://www.dentsplysirona.com', 124.00, null, 'Radiologie', 2),

-- Büromaterial (3)
('O001', 'Patientenaufklärung Implantate', 'Aufklärungsbögen DIN A4, 50 St.', 'Büromaterial', 2, 2, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 24.00, null, 'Büro', 2),
('O002', 'Terminkalender 2026', 'Wochenplaner für Praxisorganisation', 'Büromaterial', 1, 1, 'Stück', 'Henry Schein', 'https://www.henryschein.de', null, 18.00, null, 'Büro', 1),
('O003', 'Druckerpapier A4 80g (500Bl.)', 'Standardpapier für Patientenunterlagen', 'Büromaterial', 3, 2, 'Ries', 'Henry Schein', 'https://www.henryschein.de', null, 9.90, null, 'Büro', 5),

-- Füllungsmaterialien (6)
('F001', 'Tetric EvoCeram A2 Syringe', 'Nanohybrid-Komposit, Spritze 4g', 'Füllungsmaterialien', 4, 3, 'Spritze', 'Pluradent', 'https://www.pluradent.de', 'https://www.ivoclarvivadent.com', 32.00, '2027-06-01', 'Behandlungsraum 3', 4),
('F002', 'Tetric EvoCeram A3 Syringe', 'Nanohybrid-Komposit, Spritze 4g', 'Füllungsmaterialien', 2, 3, 'Spritze', 'Pluradent', 'https://www.pluradent.de', 'https://www.ivoclarvivadent.com', 32.00, '2027-06-01', 'Behandlungsraum 3', 4),
('F003', 'Ketac Molar Easymix', 'Glasionomer Füllungszement, 12.5g+8ml', 'Füllungsmaterialien', 3, 2, 'Set', 'Henry Schein', 'https://www.henryschein.de', 'https://www.3m.com', 38.00, '2026-09-01', 'Behandlungsraum 2', 3),
('F004', 'Scotchbond Universal Adhesive', 'Universalbonding 5ml', 'Füllungsmaterialien', 2, 2, 'Flasche', 'Henry Schein', 'https://www.henryschein.de', 'https://www.3m.com', 52.00, '2026-12-01', 'Behandlungsraum 3', 2),
('F005', 'Phosphorsäureätzgel 37%', 'Selektives Ätzen, 5ml Spritzen 10 St.', 'Füllungsmaterialien', 5, 3, 'Packung', 'Pluradent', 'https://www.pluradent.de', null, 18.00, '2027-01-01', 'Behandlungsraum 2', 5),
('F006', 'Fuji IX GP Extra', 'Stopfbarer Glasionomer, A2, 15g', 'Füllungsmaterialien', 2, 2, 'Packung', 'Henry Schein', 'https://www.henryschein.de', 'https://www.gceurope.com', 42.00, '2026-08-01', 'Behandlungsraum 2', 2),

-- Infektionskontrolle (5)
('I001', 'Dürr FD 322 Tücher', 'Schnelldesinfektion Oberflächen, 80 Tücher', 'Infektionskontrolle', 6, 5, 'Packung', 'Dürr Dental', 'https://www.duerrdental.com', 'https://www.duerrdental.com', 14.50, '2027-01-01', 'Steri', 6),
('I002', 'Dürr FD 333 forte 5L', 'Schnelldesinfektion alkoholisch, 5 Liter', 'Infektionskontrolle', 2, 2, 'Kanister', 'Dürr Dental', 'https://www.duerrdental.com', 'https://www.duerrdental.com', 38.00, '2027-06-01', 'Keller', 2),
('I003', 'Sterillium Händedesinfektion 500ml', 'Chirurgische Händedesinfektion', 'Infektionskontrolle', 3, 3, 'Flasche', 'Henry Schein', 'https://www.henryschein.de', 'https://www.bode-science-center.de', 12.90, '2027-01-01', 'Behandlungsraum 1', 4),
('I004', 'Abdruckdesinfektion Spray 400ml', 'Desinfektion von Abformungen', 'Infektionskontrolle', 2, 2, 'Dose', 'Pluradent', 'https://www.pluradent.de', null, 11.50, '2027-01-01', 'Steri', 3),
('I005', 'Handschuhe Nitril M blau (100)', 'Untersuchungshandschuhe puderfrei', 'Infektionskontrolle', 4, 5, 'Box', 'Henry Schein', 'https://www.henryschein.de', null, 9.90, '2028-01-01', 'Behandlungsraum 1', 6),

-- Instrumente (4)
('IN001', 'Parodontalsonde PCPUNC15', 'Farbkodierte Paro-Sonde, 5 St.', 'Instrumente', 3, 2, 'Packung', 'Pluradent', 'https://www.pluradent.de', 'https://www.hu-friedy.com', 42.00, null, 'Behandlungsraum 3', 2),
('IN002', 'Gracey Küretten Set 5/6 7/8', 'Parodontalinstrumente sterile, 4 St.', 'Instrumente', 2, 2, 'Set', 'Pluradent', 'https://www.pluradent.de', 'https://www.hu-friedy.com', 88.00, null, 'Steri', 1),
('IN003', 'Spiegel Nr.4 Rhodium (12 St.)', 'Mundspiegel mit Griff', 'Instrumente', 4, 3, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 28.00, null, 'Steri', 3),
('IN004', 'Zahnsonde Fissurensonde 6/23', 'Explorationssonde doppelendständig', 'Instrumente', 5, 3, 'Stück', 'Henry Schein', 'https://www.henryschein.de', null, 12.00, null, 'Steri', 4),

-- Kieferorthopädische Materialien (2)
('K001', 'Brackets Roth 0.022 Kit', 'MBT Brackets-Set Ober- und Unterkiefer', 'Kieferorthopädische Materialien', 3, 2, 'Kit', 'Pluradent', 'https://www.pluradent.de', 'https://www.ormco.com', 148.00, '2027-01-01', 'Behandlungsraum 4', 2),
('K002', 'Elastische Ligaturen gemischt (1000)', 'Farbige Gummiligaturen assortiert', 'Kieferorthopädische Materialien', 4, 3, 'Beutel', 'Pluradent', 'https://www.pluradent.de', null, 18.00, '2027-06-01', 'Behandlungsraum 4', 3),

-- Mundpflege (3)
('M001', 'Elmex Zahnbürste medium (12)', 'Patientenabgabe Zahnbürsten', 'Mundpflege', 2, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', 'https://www.colgate.com', 14.40, null, 'Rezeption', 5),
('M002', 'Oral-B Seide Proben (50)', 'Zahnseide-Proben für Patientenabgabe', 'Mundpflege', 3, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', 'https://www.oralb.de', 22.00, null, 'Rezeption', 4),
('M003', 'Chlorhexamed Gel 1% (10 St.)', 'CHX-Gel für Patientenabgabe', 'Mundpflege', 2, 3, 'Packung', 'Henry Schein', 'https://www.henryschein.de', 'https://www.gsk.com', 28.00, '2026-09-01', 'Rezeption', 3),

-- Persönliche Schutzausrüstung (3)
('P001', 'FFP2 Masken (20 St.)', 'Atemschutzmasken CE-zertifiziert', 'Persönliche Schutzausrüstung', 2, 3, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 22.00, '2027-01-01', 'Behandlungsraum 1', 3),
('P002', 'OP-Masken Typ IIR (50 St.)', 'Medizinische Gesichtsmasken', 'Persönliche Schutzausrüstung', 5, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 9.90, '2027-06-01', 'Behandlungsraum 1', 5),
('P003', 'Schutzbrille klar', 'Patientenschutzbrille Einweg (10 St.)', 'Persönliche Schutzausrüstung', 3, 2, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 6.50, null, 'Behandlungsraum 1', 3),

-- Reinigungs- & Desinfektionsmittel (3)
('R001', 'MD 555 Instrumentenreiniger 2L', 'Alkalischer Reiniger für Ultraschallbad', 'Reinigungs- & Desinfektionsmittel', 2, 2, 'Flasche', 'Dürr Dental', 'https://www.duerrdental.com', 'https://www.duerrdental.com', 24.00, '2027-06-01', 'Keller', 2),
('R002', 'ID 220 Instrumentendesinfektion 5L', 'Aldehyd-freies Tauchdesinfektionsmittel', 'Reinigungs- & Desinfektionsmittel', 1, 2, 'Kanister', 'Dürr Dental', 'https://www.duerrdental.com', 'https://www.duerrdental.com', 48.00, '2027-06-01', 'Keller', 2),
('R003', 'Orotol Plus 2.5L Saugsystem', 'Reiniger und Desinfektionsmittel Sauganlage', 'Reinigungs- & Desinfektionsmittel', 2, 2, 'Flasche', 'Dürr Dental', 'https://www.duerrdental.com', 'https://www.duerrdental.com', 32.00, '2027-01-01', 'Keller', 2),

-- Sterilisationsmaterialien (4)
('S001', 'Melag Sterilisierbeutel 90x230 (200)', 'Selbstklebende Sterilisierbeutel', 'Sterilisationsmaterialien', 3, 4, 'Packung', 'Melag', 'https://www.melag.com', 'https://www.melag.com', 22.00, null, 'Steri', 4),
('S002', 'Melag Sterilisierbeutel 150x300 (200)', 'Selbstklebende Sterilisierbeutel groß', 'Sterilisationsmaterialien', 2, 3, 'Packung', 'Melag', 'https://www.melag.com', 'https://www.melag.com', 28.00, null, 'Steri', 3),
('S003', 'Helicheck Bioindikatoren (50)', 'Biologische Indikatoren für Autoklav', 'Sterilisationsmaterialien', 2, 3, 'Packung', 'Melag', 'https://www.melag.com', 'https://www.melag.com', 68.00, '2026-12-01', 'Steri', 2),
('S004', 'Chemische Indikatoren Klasse 6 (250)', 'Prozessindikatoren für Sterilisation', 'Sterilisationsmaterialien', 4, 3, 'Packung', 'Melag', 'https://www.melag.com', 'https://www.melag.com', 18.00, '2027-06-01', 'Steri', 3),

-- Verbrauchsmaterialien (4)
('V001', 'Speichelsauger grün (100)', 'Einmal-Speichelsauger mit Filter', 'Verbrauchsmaterialien', 2, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 8.90, null, 'Keller', 5),
('V002', 'Watterollen Gr. 2 (500)', 'Absorbierende Watterollen', 'Verbrauchsmaterialien', 4, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 7.50, null, 'Keller', 4),
('V003', 'Patientenservietten 33x45 (125)', 'Einweglätzchen mit Clip', 'Verbrauchsmaterialien', 5, 4, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 9.00, null, 'Keller', 5),
('V004', 'Mischkanülen gelb (50)', 'Abmischkanülen für A-Silikone', 'Verbrauchsmaterialien', 3, 3, 'Packung', 'Henry Schein', 'https://www.henryschein.de', null, 14.00, null, 'Behandlungsraum 1', 4);
