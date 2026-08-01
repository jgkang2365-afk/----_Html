SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'users' AND column_name IN ('id', 'name', 'job', 'is_active'))
    OR (
      table_name = 'measurement_target_business'
      AND column_name IN ('id', 'measurer_id', 'measurement_date', 'daily_staff', 'address', 'updated_at')
    )
  )
ORDER BY table_name, ordinal_position;

SELECT requested.name, COUNT(users.id) AS matched_rows,
  ARRAY_AGG(users.id ORDER BY users.id) FILTER (WHERE users.id IS NOT NULL) AS user_ids
FROM (VALUES
  ('이태환'), ('한기문'), ('이주형'), ('강종구'), ('고유빈'), ('김민영'), ('배윤민')
) AS requested(name)
LEFT JOIN public.users ON users.name = requested.name
GROUP BY requested.name
ORDER BY requested.name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('preliminary_survey_plans', 'user_schedule_blocks');
