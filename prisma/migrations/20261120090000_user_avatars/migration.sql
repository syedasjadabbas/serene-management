-- Self-service profile pictures (UI/UX overhaul: profile editing).
--
-- One row per user, replaced on upload and removed on deletion; the user
-- row itself is untouched. Images are small (the browser crops and resizes
-- to 256 px) and stored in PostgreSQL so they follow the user to any device
-- and survive sign-out. The service checks the image signature; the checks
-- below enforce the allowed types and the size limit at the database level.
-- See docs/DATABASE_DESIGN.md §5.

-- CreateTable
CREATE TABLE "user_avatars" (
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity (hand-written; Prisma cannot express checks).
ALTER TABLE "user_avatars"
  ADD CONSTRAINT "user_avatars_content_type_check"
    CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "user_avatars_size_check"
    CHECK ("byte_size" > 0 AND "byte_size" <= 262144 AND octet_length("data") = "byte_size");
