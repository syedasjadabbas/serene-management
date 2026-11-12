-- One active session per user per client platform (docs/SERVER_SPLIT_PLAN.md section 4):
-- the platform the session was opened from. Existing sessions are web sessions.
ALTER TABLE "auth_sessions" ADD COLUMN "platform" VARCHAR(16) NOT NULL DEFAULT 'web';

-- Hand-written (Prisma cannot express it; docs/DATABASE_DESIGN.md section 5): only known platforms.
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_platform_check"
  CHECK ("platform" IN ('web', 'mobile'));
