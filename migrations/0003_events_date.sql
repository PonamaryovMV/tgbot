-- Migration 0003: Optional event date (YYYY-MM-DD) for expenses events
ALTER TABLE events ADD COLUMN event_date TEXT;
