
-- Note: 'measurer' to 'plan_manager' rename has likely already been executed.
-- If not, and you see an error about 'plan_manager' not existing, uncomment the line below:
-- ALTER TABLE measurement_target_business RENAME COLUMN measurer TO plan_manager;

-- Make plan_based_year and plan_based_period optional (nullable)
ALTER TABLE measurement_target_business ALTER COLUMN plan_based_year DROP NOT NULL;
ALTER TABLE measurement_target_business ALTER COLUMN plan_based_period DROP NOT NULL;
