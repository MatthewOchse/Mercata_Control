-- Short-TTL cache for live GA4 overview (dashboard tenant detail).
-- Prefer analytics_daily warehouse; this table is only hit when warehouse is empty.

CREATE TABLE IF NOT EXISTS ga4_cache (
  cache_key   VARCHAR(191) NOT NULL,
  payload     JSON         NOT NULL,
  fetched_at  DATETIME     NOT NULL,
  PRIMARY KEY (cache_key),
  KEY idx_ga4_cache_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
