-- ============================================================
-- PeoplePulse Database Seed
-- Botswana 2025 Tax Bands (Resident & Non-Resident)
-- Also seeds public holidays for Botswana
-- ============================================================

-- ---------------------------------------------------------------
-- COUNTRY: BOTSWANA (BW)
-- ---------------------------------------------------------------

INSERT INTO countries (id, code, name, currency_code, financial_year_start, min_wage_per_hour, leave_defaults, active, created_at, updated_at)
VALUES (
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  'BW',
  'Botswana',
  'BWP',
  '07-01',
  7.34,
  '{"annual": 15, "sick": 14, "maternity": 98, "paternity": 3}',
  true,
  NOW(),
  NOW()
) ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------
-- TAX BANDS: BOTSWANA 2025 — RESIDENT
-- Income Tax Act Cap.52:01 + Income Tax Amendment Act 2023
-- ---------------------------------------------------------------

-- Band 1: P0 – P48,000 — 0%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'b1a2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'RESIDENT',
  0,
  48000,
  0,
  0,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Band 2: P48,001 – P84,000 — 5%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'b2a3c4d5-f6a7-b8c9-d0e1-f2a3b4c5d6e',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'RESIDENT',
  48001,
  84000,
  5,
  1800,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Band 3: P84,001 – P120,000 — 12.5%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'b3a4c5d6-a7b8-c9d0-e1f2-a3b4c5d6e7f',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'RESIDENT',
  84001,
  120000,
  12.5,
  6300,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Band 4: P120,001 – P156,000 — 18.75%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'b4a5c6d7-b8c9-d0e1-f2a3-b4c5d6e7f8a9',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'RESIDENT',
  120001,
  156000,
  18.75,
  13050,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Band 5: Above P156,000 — 25% + 25% on excess
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'b5a6c7d8-c9d0-e1f2-a3b4-c5d6e7f8a9b0',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'RESIDENT',
  156001,
  NULL,
  25,
  NULL,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- ---------------------------------------------------------------
-- TAX BANDS: BOTSWANA 2025 — NON-RESIDENT
-- No zero-rate band — 5% from first pula
-- ---------------------------------------------------------------

-- Non-Resident Band 1: P0 – P84,000 — 5%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'n1a2b3c4-d5e6-f7a8-b9c0-d1e2f3a4b5c6',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'NON_RESIDENT',
  0,
  84000,
  5,
  0,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Non-Resident Band 2: P84,001 – P120,000 — 12.5%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'n2b3c4d5-e6f7-a8b9-c0d1-e2f3a4b5c6d7',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'NON_RESIDENT',
  84001,
  120000,
  12.5,
  NULL,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Non-Resident Band 3: P120,001 – P156,000 — 18.75%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'n3c4d5e6-f7a8-b9c0-d1e2-f3a4b5c6d7e8',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'NON_RESIDENT',
  120001,
  156000,
  18.75,
  NULL,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- Non-Resident Band 4: Above P156,000 — 25%
INSERT INTO tax_bands (id, country_id, tax_year, resident_status, band_min, band_max, rate_percent, cumulative_tax_below, active, created_at, updated_at)
VALUES (
  'n4d5e6f7-a8b9-c0d1-e2f3-a4b5c6d7e8f9',
  'c0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
  2025,
  'NON_RESIDENT',
  156001,
  NULL,
  25,
  NULL,
  true,
  NOW(),
  NOW()
) ON CONFLICT (country_id, tax_year, resident_status, band_min) DO NOTHING;

-- ---------------------------------------------------------------
-- PUBLIC HOLIDAYS: BOTSWANA 2025
-- ---------------------------------------------------------------

INSERT INTO public_holidays (id, country_code, name, date, applicable_regions, active, created_at, updated_at) VALUES
('h1a2b3c4-d5e6-f7a8-b9c0-d1e2f3a4b5c1', 'BW', 'New Year''s Day', '2025-01-01', '{}', true, NOW(), NOW()),
('h2b3c4d5-e6f7-a8b9-c0d1-e2f3a4b5c2d', 'BW', 'Good Friday', '2025-04-18', '{}', true, NOW(), NOW()),
('h3c4d5e6-f7a8-b9c0-d1e2-f3a4b5c6d3e', 'BW', 'Easter Monday', '2025-04-21', '{}', true, NOW(), NOW()),
('h4d5e6f7-a8b9-c0d1-e2f3-a4b5c6d4f', 'BW', 'Labour Day', '2025-05-01', '{}', true, NOW(), NOW()),
('h5e6f7a8-b9c0-d1e2-f3a4-b5c6d7e8f5', 'BW', 'Ascension Day', '2025-05-29', '{}', true, NOW(), NOW()),
('h6f7a8b9-c0d1-e2f3-a4b5-c6d7e8f9a6', 'BW', 'Sir Ketumile Masute Day', '2025-07-01', '{}', true, NOW(), NOW()),
('h7a8b9c0-d1e2-f3a4-b5c6-d7e8f9a0b7', 'BW', 'Botswana Day', '2025-09-30', '{}', true, NOW(), NOW()),
('h8b9c0d1-e2f3-a4b5c6-d7e8f9a0b1c8', 'BW', 'Independence Day', '2025-10-01', '{}', true, NOW(), NOW()),
('h9c0d1e2-f3a4-b5c6d7-e8f9a0b1c2d9', 'BW', 'Christmas Day', '2025-12-25', '{}', true, NOW(), NOW()),
('h0c1d2e3-f4a5-b6c7d8-e9f0-a1b2c3d4e0', 'BW', 'Boxing Day', '2025-12-26', '{}', true, NOW(), NOW()),
-- 2026 holidays
('h1d2e3f4-a5b6-c7d8-e9f0-a1b2c3d4e5f', 'BW', 'New Year''s Day', '2026-01-01', '{}', true, NOW(), NOW()),
('h2e3f4a5-b6c7-d8e9-f0a1-b2c3d4e5f6a', 'BW', 'Good Friday', '2026-04-03', '{}', true, NOW(), NOW()),
('h3f4a5b6-c7d8-e9f0-a1b2-c3d4e5f6a7b', 'BW', 'Easter Monday', '2026-04-06', '{}', true, NOW(), NOW()),
('h4a5b6c7-d8e9-f0a1-b2c3-d4e5f6a7b8c', 'BW', 'Labour Day', '2026-05-01', '{}', true, NOW(), NOW()),
('h5b6c7d8-e9f0-a1b2-c3d4-e5f6a7b8c9d', 'BW', 'Ascension Day', '2026-05-14', '{}', true, NOW(), NOW()),
('h6c7d8e9-f0a1-b2c3-d4e5-f6a7b8c9d0e', 'BW', 'Sir Ketumile Masute Day', '2026-07-01', '{}', true, NOW(), NOW()),
('h7d8e9f0-a1b2-c3d4-e5f6-a7b8c9d0e1f', 'BW', 'Botswana Day', '2026-09-30', '{}', true, NOW(), NOW()),
('h8e9f0a1-b2c3-d4e5-f6a7-b8c9d0e1f2a', 'BW', 'Independence Day', '2026-10-01', '{}', true, NOW(), NOW()),
('h9f0a1b2-c3d4-e5f6-a7b8c9d0e1f2a3b', 'BW', 'Christmas Day', '2026-12-25', '{}', true, NOW(), NOW()),
('h0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c', 'BW', 'Boxing Day', '2026-12-26', '{}', true, NOW(), NOW())
ON CONFLICT (country_code, date) DO NOTHING;
