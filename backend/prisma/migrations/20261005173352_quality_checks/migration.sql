-- AlterEnum
ALTER TYPE "StepPhase" ADD VALUE 'review';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "brief" TEXT;

-- AlterTable
ALTER TABLE "GoalTask" ADD COLUMN     "review" JSONB;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "qualityChecks" BOOLEAN NOT NULL DEFAULT true;
