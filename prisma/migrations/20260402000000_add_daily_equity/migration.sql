-- CreateTable: DailyEquity
-- Records actual portfolio equity snapshots per account per day (e.g. from Firstrade API)

CREATE TABLE IF NOT EXISTS "public"."DailyEquity" (
    "id"            TEXT        NOT NULL,
    "userId"        TEXT        NOT NULL,
    "accountNumber" TEXT        NOT NULL,
    "date"          DATE        NOT NULL,
    "equity"        DOUBLE PRECISION NOT NULL,
    "cash"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyEquity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DailyEquity_userId_accountNumber_date_key"
    ON "public"."DailyEquity"("userId", "accountNumber", "date");

CREATE INDEX IF NOT EXISTS "DailyEquity_userId_accountNumber_idx"
    ON "public"."DailyEquity"("userId", "accountNumber");

-- EnableRLS
ALTER TABLE "public"."DailyEquity" ENABLE ROW LEVEL SECURITY;
