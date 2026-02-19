-- Add google_event_id to measurement_target_business table
ALTER TABLE measurement_target_business
ADD COLUMN google_event_id TEXT;
