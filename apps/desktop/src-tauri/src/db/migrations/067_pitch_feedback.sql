ALTER TABLE user_preferences ADD COLUMN pitch_feedback_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN pitch_threshold_hz REAL NOT NULL DEFAULT 155.0;
