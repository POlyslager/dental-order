-- Add expiry date and storage location columns (run this first)
alter table products add column if not exists expiry_date date;
alter table products add column if not exists storage_location text;
alter table products add column if not exists article_number text unique;
alter table products add column if not exists reorder_quantity numeric;

-- Delete fake seed data if it was already inserted
delete from products;

-- Insert real inventory from Inventaris.xlsx
insert into products (article_number, name, category, current_stock, min_stock, unit, preferred_supplier, supplier_url, last_price, expiry_date, storage_location, notes, reorder_quantity) values
('A001',  'Alginat Abformmaterial',            'Abformmaterialien',                    7,  5,  'pcs', 'DentalDepot',   'https://dentalform.de',    2.89,  '2025-06-07', 'Behandlungsraum 1', null, null),
('A002',  'Silikon-Abdruckmasse',               'Abformmaterialien',                    13, 5,  'pcs', 'DentalExpress', 'https://dentalform.de',    5.99,  '2025-06-30', 'Behandlungsraum 1', null, null),
('AN001', 'Lokalanästhetikum Ampullen',         'Anästhetika',                          53, 10, 'pcs', 'InstruMed',     'https://pharmadent.de',    12.90, '2025-06-30', 'Steri',             null, null),
('AN002', 'Topisches Gel',                      'Anästhetika',                          5,  5,  'pcs', 'InstruMed',     'https://pharmadent.de',    24.40, '2025-06-28', 'Steri',             '500ml', 15),
('E001',  'Behandlungseinheit',                 'Ausrüstung',                           3,  2,  'pcs', 'SterileOne',    'https://dentalequip.de',   17.99, '2026-01-18', 'Behandlungsraum 4', null, null),
('E002',  'Lichtpolymerisationsgerät',          'Ausrüstung',                           11, 10, 'pcs', 'SterileOne',    'https://dentalequip.de',   21.60, '2025-06-10', 'Rezeption',         null, null),
('B001',  'Röntgen-Sensoren',                   'Bildgebende Materialien',              10, 3,  'pcs', 'ImagingDental', 'https://imagingpro.de',    10.20, '2026-12-22', 'Küche',             null, null),
('B002',  'Bleischürzen',                       'Bildgebende Materialien',              1,  1,  'pcs', 'ImagingDental', 'https://imagingpro.de',    5.99,  '2025-06-22', 'Behandlungsraum 5', null, 4),
('O001',  'Druckerpapier',                      'Büromaterial',                         1,  2,  'pcs', 'DentalTech',    'https://officesupply.de',  12.90, '2025-12-05', 'Büro',              '500 Blatt', 4),
('O002',  'Kugelschreiber',                     'Büromaterial',                         4,  0,  'pcs', 'DentalTech',    'https://officesupply.de',  24.40, '2025-06-05', 'Büro',              null, null),
('F001',  'Kompositfüllung A2',                 'Füllungsmaterialien',                  6,  10, 'pcs', 'OralCarePlus',  'https://restaurodent.de',  17.99, '2027-10-25', 'Behandlungsraum 3', null, 44),
('F002',  'Glasionomer-Zement',                 'Füllungsmaterialien',                  8,  5,  'pcs', 'OralCarePlus',  'https://restaurodent.de',  21.60, '2025-07-03', 'Büro',              null, null),
('I001',  'Desinfektionstücher',                'Infektionskontrolle',                  17, 5,  'pcs', 'DentalDepot',   'https://hygieneplus.de',   4.20,  '2025-06-14', 'Steri',             null, null),
('I002',  'Flächendesinfektion',                'Infektionskontrolle',                  2,  2,  'pcs', 'DentalExpress', 'https://hygieneplus.de',   11.40, '2026-09-01', 'Steri',             null, 3),
('IN001', 'Parodontalsonde',                    'Instrumente',                          4,  2,  'pcs', 'InstruMed',     'https://instrucare.de',    17.34, '2025-06-17', 'Behandlungsraum 3', null, null),
('IN002', 'Kürette',                            'Instrumente',                          15, 5,  'pcs', 'InstruMed',     'https://instrucare.de',    8.90,  '2025-06-13', 'Behandlungsraum 5', null, null),
('K001',  'Brackets',                           'Kieferorthopädische Materialien',      50, 30, 'pcs', 'SterileOne',    'https://ortholine.de',     1.99,  '2025-06-18', 'Behandlungsraum 4', null, null),
('K002',  'Ligaturen',                          'Kieferorthopädische Materialien',      16, 10, 'pcs', 'SterileOne',    'https://ortholine.de',     10.20, '2025-06-25', 'Radiologie',        null, null),
('M001',  'Zahnseide Proben',                   'Mundpflege',                           16, 5,  'pcs', 'ImagingDental', 'https://smilecare.de',     5.99,  '2025-06-06', 'Behandlungsraum 3', '3 Packung', null),
('M002',  'Zahnbürsten Proben',                 'Mundpflege',                           3,  4,  'pcs', 'ImagingDental', 'https://smilecare.de',     12.90, '2025-11-11', 'Rezeption',         '10 Packung', 12),
('P001',  'Mundschutz FFP2',                    'Persönliche Schutzausrüstung',         2,  2,  'pcs', 'DentalTech',    'https://protectdent.de',   24.40, '2025-08-14', 'Behandlungsraum 3', '200 pro Box', 2),
('P002',  'Einweghandschuhe',                   'Persönliche Schutzausrüstung',         3,  2,  'pcs', 'DentalTech',    'https://protectdent.de',   17.99, '2027-12-31', 'Küche',             '500 pro Box', null),
('R001',  'Instrumentenreiniger',               'Reinigungs- & Desinfektionsmittel',    5,  2,  'pcs', 'OralCarePlus',  'https://cleanmed.de',      21.60, '2026-04-09', 'Keller',            null, null),
('R002',  'Ultraschallreiniger-Flüssigkeit',    'Reinigungs- & Desinfektionsmittel',    2,  3,  'pcs', 'OralCarePlus',  'https://cleanmed.de',      10.20, '2027-01-04', 'Keller',            null, 10),
('S001',  'Sterilisationsbeutel',               'Sterilisationsmaterialien',            4,  1,  'pcs', 'DentalDepot',   'https://sterilplus.de',    5.99,  '2026-06-06', 'Steri',             null, null),
('S002',  'Indikatorstreifen',                  'Sterilisationsmaterialien',            13, 5,  'pcs', 'DentalExpress', 'https://sterilplus.de',    12.90, '2025-07-01', 'Steri',             null, null),
('V001',  'Speichelsauger',                     'Verbrauchsmaterialien',                1,  1,  'pcs', 'InstruMed',     'https://dentaldepot.de',   24.40, '2027-05-27', 'Keller',            null, 4),
('V002',  'Watterollen',                        'Verbrauchsmaterialien',                24, 8,  'pcs', 'InstruMed',     'https://dentaldepot.de',   17.99, '2027-08-30', 'Keller',            null, null);
