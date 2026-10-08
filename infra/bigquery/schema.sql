-- Analytical export schema; source of truth remains PostgreSQL.
CREATE TABLE IF NOT EXISTS `portfolio.loom_events` (
  event_id INT64,
  event STRING,
  user_id INT64,
  created_at TIMESTAMP,
  detail_json STRING
);
