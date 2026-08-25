BEGIN;

CREATE TABLE rate_limit_windows (
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  CONSTRAINT rate_limit_windows_count_check CHECK (request_count > 0),
  PRIMARY KEY (key_hash, window_started_at)
);

CREATE INDEX rate_limit_windows_window_started_at_idx
  ON rate_limit_windows (window_started_at);

REVOKE ALL ON rate_limit_windows FROM PUBLIC;

COMMIT;
