BEGIN;

CREATE TEMP TABLE tmp_2026_h2_business_type_manifest (
  code text NOT NULL,
  year integer NOT NULL,
  period text NOT NULL,
  business_type text NOT NULL,
  PRIMARY KEY (code, year, period),
  CHECK (business_type IN ('existing', 'first_measurement', 'external_new'))
) ON COMMIT DROP;

INSERT INTO tmp_2026_h2_business_type_manifest (code, year, period, business_type)
VALUES
  ('H0006', 2026, '하반기', 'existing'),
  ('H0007', 2026, '하반기', 'existing'),
  ('H0010', 2026, '하반기', 'existing'),
  ('H0011', 2026, '하반기', 'existing'),
  ('H0012', 2026, '하반기', 'existing'),
  ('H0014', 2026, '하반기', 'existing'),
  ('H0015', 2026, '하반기', 'existing'),
  ('H0016', 2026, '하반기', 'existing'),
  ('H0017', 2026, '하반기', 'existing'),
  ('H0018', 2026, '하반기', 'existing'),
  ('H0020', 2026, '하반기', 'existing'),
  ('H0021', 2026, '하반기', 'existing'),
  ('H0024', 2026, '하반기', 'existing'),
  ('H0025', 2026, '하반기', 'existing'),
  ('H0026', 2026, '하반기', 'existing'),
  ('H0027', 2026, '하반기', 'existing'),
  ('H0028', 2026, '하반기', 'existing'),
  ('H0029', 2026, '하반기', 'existing'),
  ('H0030', 2026, '하반기', 'existing'),
  ('H0031', 2026, '하반기', 'existing'),
  ('H0032', 2026, '하반기', 'existing'),
  ('H0033', 2026, '하반기', 'existing'),
  ('H0034', 2026, '하반기', 'existing'),
  ('H0035', 2026, '하반기', 'existing'),
  ('H0037', 2026, '하반기', 'existing'),
  ('H0038', 2026, '하반기', 'existing'),
  ('H0041', 2026, '하반기', 'existing'),
  ('H0042', 2026, '하반기', 'existing'),
  ('H0043', 2026, '하반기', 'existing'),
  ('H0044', 2026, '하반기', 'existing'),
  ('H0045', 2026, '하반기', 'existing'),
  ('H0047', 2026, '하반기', 'existing'),
  ('H0048', 2026, '하반기', 'existing'),
  ('H0049', 2026, '하반기', 'existing'),
  ('H0050', 2026, '하반기', 'existing'),
  ('H0051', 2026, '하반기', 'existing'),
  ('H0052', 2026, '하반기', 'existing'),
  ('H0053', 2026, '하반기', 'existing'),
  ('H0054', 2026, '하반기', 'existing'),
  ('H0055', 2026, '하반기', 'existing'),
  ('H0056', 2026, '하반기', 'existing'),
  ('H0057', 2026, '하반기', 'existing'),
  ('H0058', 2026, '하반기', 'existing'),
  ('H0060', 2026, '하반기', 'existing'),
  ('H0061', 2026, '하반기', 'existing'),
  ('H0062', 2026, '하반기', 'existing'),
  ('H0063', 2026, '하반기', 'existing'),
  ('H0064', 2026, '하반기', 'existing'),
  ('H0065', 2026, '하반기', 'existing'),
  ('H0066', 2026, '하반기', 'existing'),
  ('H0067', 2026, '하반기', 'existing'),
  ('H0068', 2026, '하반기', 'existing'),
  ('H0069', 2026, '하반기', 'existing'),
  ('H0070', 2026, '하반기', 'existing'),
  ('H0071', 2026, '하반기', 'existing'),
  ('H0072', 2026, '하반기', 'existing'),
  ('H0073', 2026, '하반기', 'existing'),
  ('H0074', 2026, '하반기', 'existing'),
  ('H0075', 2026, '하반기', 'existing'),
  ('H0076', 2026, '하반기', 'existing'),
  ('H0077', 2026, '하반기', 'existing'),
  ('H0078', 2026, '하반기', 'existing'),
  ('H0079', 2026, '하반기', 'existing'),
  ('H0080', 2026, '하반기', 'existing'),
  ('H0081', 2026, '하반기', 'existing'),
  ('H0082', 2026, '하반기', 'existing'),
  ('H0083', 2026, '하반기', 'existing'),
  ('H0084', 2026, '하반기', 'existing'),
  ('H0085', 2026, '하반기', 'existing'),
  ('H0086', 2026, '하반기', 'existing'),
  ('H0087', 2026, '하반기', 'existing'),
  ('H0088', 2026, '하반기', 'existing'),
  ('H0089', 2026, '하반기', 'existing'),
  ('H0090', 2026, '하반기', 'existing'),
  ('H0091', 2026, '하반기', 'existing'),
  ('H0092', 2026, '하반기', 'existing'),
  ('H0093', 2026, '하반기', 'existing'),
  ('H0094', 2026, '하반기', 'existing'),
  ('H0095', 2026, '하반기', 'existing'),
  ('H0096', 2026, '하반기', 'existing'),
  ('H0098', 2026, '하반기', 'existing'),
  ('H0099', 2026, '하반기', 'existing'),
  ('H0100', 2026, '하반기', 'existing'),
  ('H0101', 2026, '하반기', 'existing'),
  ('H0102', 2026, '하반기', 'existing'),
  ('H0104', 2026, '하반기', 'existing'),
  ('H0105', 2026, '하반기', 'existing'),
  ('H0106', 2026, '하반기', 'existing'),
  ('H0107', 2026, '하반기', 'existing'),
  ('H0108', 2026, '하반기', 'existing'),
  ('H0111', 2026, '하반기', 'existing'),
  ('H0112', 2026, '하반기', 'existing'),
  ('H0113', 2026, '하반기', 'existing'),
  ('H0114', 2026, '하반기', 'existing'),
  ('H0115', 2026, '하반기', 'existing'),
  ('H0117', 2026, '하반기', 'existing'),
  ('H0119', 2026, '하반기', 'existing'),
  ('H0120', 2026, '하반기', 'existing'),
  ('H0121', 2026, '하반기', 'existing'),
  ('H0122', 2026, '하반기', 'existing'),
  ('H0123', 2026, '하반기', 'existing'),
  ('H0125', 2026, '하반기', 'existing'),
  ('H0126', 2026, '하반기', 'existing'),
  ('H0127', 2026, '하반기', 'existing'),
  ('H0130', 2026, '하반기', 'existing'),
  ('H0131', 2026, '하반기', 'existing'),
  ('H0132', 2026, '하반기', 'existing'),
  ('H0133', 2026, '하반기', 'existing'),
  ('H0134', 2026, '하반기', 'existing'),
  ('H0135', 2026, '하반기', 'existing'),
  ('H0136', 2026, '하반기', 'existing'),
  ('H0137', 2026, '하반기', 'existing'),
  ('H0138', 2026, '하반기', 'existing'),
  ('H0139', 2026, '하반기', 'existing'),
  ('H0142', 2026, '하반기', 'existing'),
  ('H0143', 2026, '하반기', 'existing'),
  ('H0149', 2026, '하반기', 'existing'),
  ('H0151', 2026, '하반기', 'existing'),
  ('H0152', 2026, '하반기', 'existing'),
  ('H0156', 2026, '하반기', 'existing'),
  ('H0157', 2026, '하반기', 'existing'),
  ('H0159', 2026, '하반기', 'existing'),
  ('H0160', 2026, '하반기', 'existing'),
  ('H0162', 2026, '하반기', 'existing'),
  ('H0163', 2026, '하반기', 'existing'),
  ('H0164', 2026, '하반기', 'existing'),
  ('H0167', 2026, '하반기', 'existing'),
  ('H0169', 2026, '하반기', 'existing'),
  ('H0172', 2026, '하반기', 'existing'),
  ('H0175', 2026, '하반기', 'existing'),
  ('H0176', 2026, '하반기', 'existing'),
  ('H0178', 2026, '하반기', 'existing'),
  ('H0179', 2026, '하반기', 'existing'),
  ('H0181', 2026, '하반기', 'existing'),
  ('H0182', 2026, '하반기', 'existing'),
  ('H0186', 2026, '하반기', 'existing'),
  ('H0188', 2026, '하반기', 'existing'),
  ('H0189', 2026, '하반기', 'existing'),
  ('H0190', 2026, '하반기', 'existing'),
  ('H0191', 2026, '하반기', 'existing'),
  ('H0195', 2026, '하반기', 'existing'),
  ('H0196', 2026, '하반기', 'existing'),
  ('H0200', 2026, '하반기', 'existing'),
  ('H0202', 2026, '하반기', 'existing'),
  ('H0203', 2026, '하반기', 'existing'),
  ('H0204', 2026, '하반기', 'existing'),
  ('H0205', 2026, '하반기', 'existing'),
  ('H0207', 2026, '하반기', 'existing'),
  ('H0208', 2026, '하반기', 'existing'),
  ('H0213', 2026, '하반기', 'existing'),
  ('H0215', 2026, '하반기', 'existing'),
  ('H0216', 2026, '하반기', 'existing'),
  ('H0217', 2026, '하반기', 'existing'),
  ('H0218', 2026, '하반기', 'existing'),
  ('H0221', 2026, '하반기', 'existing'),
  ('H0225', 2026, '하반기', 'existing'),
  ('H0226', 2026, '하반기', 'existing'),
  ('H0227', 2026, '하반기', 'existing'),
  ('H0231', 2026, '하반기', 'existing'),
  ('H0232', 2026, '하반기', 'existing'),
  ('H0235', 2026, '하반기', 'existing'),
  ('H0238', 2026, '하반기', 'existing'),
  ('H0239', 2026, '하반기', 'existing'),
  ('H0240', 2026, '하반기', 'existing'),
  ('H0241', 2026, '하반기', 'existing'),
  ('H0242', 2026, '하반기', 'existing'),
  ('H0244', 2026, '하반기', 'existing'),
  ('H0245', 2026, '하반기', 'existing'),
  ('H0246', 2026, '하반기', 'existing'),
  ('H0248', 2026, '하반기', 'existing'),
  ('H0249', 2026, '하반기', 'existing'),
  ('H0250', 2026, '하반기', 'existing'),
  ('H0253', 2026, '하반기', 'existing'),
  ('H0255', 2026, '하반기', 'existing'),
  ('H0257', 2026, '하반기', 'existing'),
  ('H0258', 2026, '하반기', 'existing'),
  ('H0259', 2026, '하반기', 'existing'),
  ('H0260', 2026, '하반기', 'existing'),
  ('H0262', 2026, '하반기', 'existing'),
  ('H0263', 2026, '하반기', 'existing'),
  ('H0266', 2026, '하반기', 'existing'),
  ('H0267', 2026, '하반기', 'existing'),
  ('H0268', 2026, '하반기', 'existing'),
  ('H0270', 2026, '하반기', 'existing'),
  ('H0272', 2026, '하반기', 'existing'),
  ('H0273', 2026, '하반기', 'existing'),
  ('H0274', 2026, '하반기', 'existing'),
  ('H0275', 2026, '하반기', 'existing'),
  ('H0277', 2026, '하반기', 'existing'),
  ('H0278', 2026, '하반기', 'existing'),
  ('H0279', 2026, '하반기', 'existing'),
  ('H0280', 2026, '하반기', 'existing'),
  ('H0281', 2026, '하반기', 'existing'),
  ('H0288', 2026, '하반기', 'existing'),
  ('H0290', 2026, '하반기', 'existing'),
  ('H0293', 2026, '하반기', 'existing'),
  ('H0294', 2026, '하반기', 'existing'),
  ('H0296', 2026, '하반기', 'existing'),
  ('H0298', 2026, '하반기', 'existing'),
  ('H0299', 2026, '하반기', 'existing'),
  ('H0300', 2026, '하반기', 'existing'),
  ('H0304', 2026, '하반기', 'existing'),
  ('H0305', 2026, '하반기', 'existing'),
  ('H0307', 2026, '하반기', 'existing'),
  ('H0319', 2026, '하반기', 'existing'),
  ('H0320', 2026, '하반기', 'existing'),
  ('H0321', 2026, '하반기', 'existing'),
  ('H0323', 2026, '하반기', 'existing'),
  ('H0325', 2026, '하반기', 'existing'),
  ('H0340', 2026, '하반기', 'existing'),
  ('H0345', 2026, '하반기', 'existing'),
  ('H0346', 2026, '하반기', 'existing'),
  ('H0347', 2026, '하반기', 'existing'),
  ('H0348', 2026, '하반기', 'existing'),
  ('H0349', 2026, '하반기', 'existing'),
  ('H0350', 2026, '하반기', 'existing'),
  ('H0351', 2026, '하반기', 'existing'),
  ('H0352', 2026, '하반기', 'existing'),
  ('H0353', 2026, '하반기', 'existing'),
  ('H0354', 2026, '하반기', 'existing'),
  ('H0356', 2026, '하반기', 'existing'),
  ('H0361', 2026, '하반기', 'existing'),
  ('H0362', 2026, '하반기', 'existing'),
  ('H0363', 2026, '하반기', 'existing'),
  ('H0365', 2026, '하반기', 'existing'),
  ('H0368', 2026, '하반기', 'existing'),
  ('H0381', 2026, '하반기', 'existing'),
  ('H0382', 2026, '하반기', 'existing'),
  ('H0383', 2026, '하반기', 'existing'),
  ('H0388', 2026, '하반기', 'existing'),
  ('H0389', 2026, '하반기', 'existing'),
  ('H0390', 2026, '하반기', 'existing'),
  ('H0391', 2026, '하반기', 'existing'),
  ('H0392', 2026, '하반기', 'existing'),
  ('H0394', 2026, '하반기', 'existing'),
  ('H0398', 2026, '하반기', 'existing'),
  ('H0399', 2026, '하반기', 'existing'),
  ('H0400', 2026, '하반기', 'existing'),
  ('H0401', 2026, '하반기', 'existing'),
  ('H0403', 2026, '하반기', 'existing'),
  ('H0404', 2026, '하반기', 'existing'),
  ('H0405', 2026, '하반기', 'existing'),
  ('H0406', 2026, '하반기', 'existing'),
  ('H0410', 2026, '하반기', 'existing'),
  ('H0411', 2026, '하반기', 'existing'),
  ('H0417', 2026, '하반기', 'existing'),
  ('H0418', 2026, '하반기', 'existing'),
  ('H0420', 2026, '하반기', 'existing'),
  ('H0429', 2026, '하반기', 'existing'),
  ('H0430', 2026, '하반기', 'existing'),
  ('H0431', 2026, '하반기', 'existing'),
  ('H0432', 2026, '하반기', 'existing'),
  ('H0433', 2026, '하반기', 'existing'),
  ('H0434', 2026, '하반기', 'existing'),
  ('H0435', 2026, '하반기', 'existing'),
  ('H0436', 2026, '하반기', 'existing'),
  ('H0437', 2026, '하반기', 'existing'),
  ('H0438', 2026, '하반기', 'existing'),
  ('H0439', 2026, '하반기', 'existing'),
  ('H0440', 2026, '하반기', 'existing'),
  ('H0442', 2026, '하반기', 'existing'),
  ('H0446', 2026, '하반기', 'existing'),
  ('H0447', 2026, '하반기', 'existing'),
  ('H0448', 2026, '하반기', 'existing'),
  ('H0449', 2026, '하반기', 'existing'),
  ('H0452', 2026, '하반기', 'existing'),
  ('H0453', 2026, '하반기', 'existing'),
  ('H0454', 2026, '하반기', 'existing'),
  ('H0455', 2026, '하반기', 'existing'),
  ('H0456', 2026, '하반기', 'existing'),
  ('H0457', 2026, '하반기', 'existing'),
  ('H0459', 2026, '하반기', 'existing'),
  ('H0460', 2026, '하반기', 'existing'),
  ('H0461', 2026, '하반기', 'existing'),
  ('H0462', 2026, '하반기', 'existing'),
  ('H0463', 2026, '하반기', 'existing'),
  ('H0464', 2026, '하반기', 'existing'),
  ('H0466', 2026, '하반기', 'existing'),
  ('H0468', 2026, '하반기', 'existing'),
  ('H0469', 2026, '하반기', 'existing'),
  ('H0470', 2026, '하반기', 'existing'),
  ('H0471', 2026, '하반기', 'existing'),
  ('H0473', 2026, '하반기', 'existing'),
  ('H0474', 2026, '하반기', 'existing'),
  ('H0475', 2026, '하반기', 'existing'),
  ('H0476', 2026, '하반기', 'existing'),
  ('H0477', 2026, '하반기', 'existing'),
  ('H0479', 2026, '하반기', 'existing'),
  ('H0480', 2026, '하반기', 'existing'),
  ('H0481', 2026, '하반기', 'existing'),
  ('H0482', 2026, '하반기', 'existing'),
  ('H0483', 2026, '하반기', 'existing'),
  ('H0484', 2026, '하반기', 'existing'),
  ('H0485', 2026, '하반기', 'existing'),
  ('H0486', 2026, '하반기', 'existing'),
  ('H0487', 2026, '하반기', 'existing'),
  ('H0488', 2026, '하반기', 'existing'),
  ('H0489', 2026, '하반기', 'existing'),
  ('H0490', 2026, '하반기', 'existing'),
  ('H0491', 2026, '하반기', 'existing'),
  ('H0492', 2026, '하반기', 'existing'),
  ('H0493', 2026, '하반기', 'first_measurement'),
  ('H0494', 2026, '하반기', 'first_measurement'),
  ('H0495', 2026, '하반기', 'existing'),
  ('H0496', 2026, '하반기', 'first_measurement'),
  ('H0497', 2026, '하반기', 'first_measurement'),
  ('H0498', 2026, '하반기', 'first_measurement'),
  ('H0499', 2026, '하반기', 'first_measurement'),
  ('H0500', 2026, '하반기', 'external_new'),
  ('H0501', 2026, '하반기', 'external_new'),
  ('H0502', 2026, '하반기', 'external_new'),
  ('H0503', 2026, '하반기', 'external_new'),
  ('H0504', 2026, '하반기', 'first_measurement'),
  ('H0505', 2026, '하반기', 'first_measurement'),
  ('H0506', 2026, '하반기', 'external_new'),
  ('H0507', 2026, '하반기', 'first_measurement'),
  ('H0508', 2026, '하반기', 'first_measurement'),
  ('H0509', 2026, '하반기', 'first_measurement'),
  ('H0510', 2026, '하반기', 'first_measurement'),
  ('H0511', 2026, '하반기', 'first_measurement'),
  ('H0512', 2026, '하반기', 'external_new'),
  ('H0513', 2026, '하반기', 'first_measurement'),
  ('H0514', 2026, '하반기', 'first_measurement'),
  ('H0515', 2026, '하반기', 'external_new'),
  ('H0516', 2026, '하반기', 'first_measurement'),
  ('H0518', 2026, '하반기', 'first_measurement'),
  ('H0519', 2026, '하반기', 'first_measurement'),
  ('H0520', 2026, '하반기', 'first_measurement'),
  ('H0521', 2026, '하반기', 'first_measurement'),
  ('H0523', 2026, '하반기', 'first_measurement');

DO $$
DECLARE
  v_manifest_count integer;
  v_existing integer;
  v_first integer;
  v_external integer;
  v_target_count integer;
  v_missing integer;
  v_extra integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE business_type = 'existing'),
         count(*) FILTER (WHERE business_type = 'first_measurement'),
         count(*) FILTER (WHERE business_type = 'external_new')
    INTO v_manifest_count, v_existing, v_first, v_external
  FROM tmp_2026_h2_business_type_manifest;

  IF v_manifest_count <> 330 OR v_existing <> 302 OR v_first <> 21 OR v_external <> 7 THEN
    RAISE EXCEPTION 'manifest mismatch: total %, existing %, first %, external %',
      v_manifest_count, v_existing, v_first, v_external;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_2026_h2_business_type_manifest
    WHERE year <> 2026 OR period <> '하반기'
  ) THEN
    RAISE EXCEPTION 'manifest scope mismatch';
  END IF;

  SELECT count(*) INTO v_target_count
  FROM public.measurement_target_business
  WHERE year = 2026 AND period = '하반기';

  SELECT count(*) INTO v_missing
  FROM tmp_2026_h2_business_type_manifest m
  LEFT JOIN public.measurement_target_business t
    ON t.code = m.code AND t.year = m.year AND t.period = m.period
  WHERE t.id IS NULL;

  SELECT count(*) INTO v_extra
  FROM public.measurement_target_business t
  LEFT JOIN tmp_2026_h2_business_type_manifest m
    ON m.code = t.code AND m.year = t.year AND m.period = t.period
  WHERE t.year = 2026 AND t.period = '하반기' AND m.code IS NULL;

  IF v_target_count <> 330 OR v_missing <> 0 OR v_extra <> 0 THEN
    RAISE EXCEPTION 'target scope mismatch: total %, missing %, extra %',
      v_target_count, v_missing, v_extra;
  END IF;
END $$;

CREATE TEMP TABLE tmp_2026_h2_business_type_resolved ON COMMIT DROP AS
SELECT t.id, m.business_type
FROM tmp_2026_h2_business_type_manifest m
JOIN public.measurement_target_business t
  ON t.code = m.code AND t.year = m.year AND t.period = m.period;

DO $$
BEGIN
  IF (SELECT count(*) FROM tmp_2026_h2_business_type_resolved) <> 330 THEN
    RAISE EXCEPTION 'resolved id count mismatch';
  END IF;
END $$;

DO $$
DECLARE
  v_affected integer;
BEGIN
  UPDATE public.measurement_target_business t
  SET business_type = r.business_type
  FROM tmp_2026_h2_business_type_resolved r
  WHERE t.id = r.id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 330 THEN
    RAISE EXCEPTION 'affected row mismatch: %', v_affected;
  END IF;
END $$;

DO $$
DECLARE
  v_existing integer;
  v_first integer;
  v_external integer;
  v_null integer;
  v_other integer;
BEGIN
  SELECT count(*) FILTER (WHERE business_type = 'existing'),
         count(*) FILTER (WHERE business_type = 'first_measurement'),
         count(*) FILTER (WHERE business_type = 'external_new'),
         count(*) FILTER (WHERE business_type IS NULL),
         count(*) FILTER (
           WHERE business_type IS NOT NULL
             AND business_type NOT IN ('existing', 'first_measurement', 'external_new')
         )
    INTO v_existing, v_first, v_external, v_null, v_other
  FROM public.measurement_target_business
  WHERE year = 2026 AND period = '하반기';

  IF v_existing <> 302 OR v_first <> 21 OR v_external <> 7 OR v_null <> 0 OR v_other <> 0 THEN
    RAISE EXCEPTION 'backfill mismatch: existing %, first %, external %, null %, other %',
      v_existing, v_first, v_external, v_null, v_other;
  END IF;
END $$;

COMMIT;
