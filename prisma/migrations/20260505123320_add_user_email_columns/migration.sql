-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "generatedByEmail" TEXT;

-- AlterTable
ALTER TABLE "SearchLog" ADD COLUMN     "searchedByEmail" TEXT;

-- CreateIndex
CREATE INDEX "Report_generatedByEmail_idx" ON "Report"("generatedByEmail");

-- CreateIndex
CREATE INDEX "SearchLog_searchedByEmail_idx" ON "SearchLog"("searchedByEmail");
