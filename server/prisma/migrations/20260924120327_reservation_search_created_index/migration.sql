-- CreateIndex
CREATE INDEX "reservation_rooms_property_id_created_at_idx" ON "reservation_rooms"("property_id", "created_at" DESC);
