import type { Outcome } from "./result-schema";

export function reviewWarningVisibility(
  outcome: Outcome,
  warningCount: number,
  showReviewWarnings: boolean,
) {
  const isReviewOutcome = outcome === "needs_review";
  return {
    outcomeCard: !isReviewOutcome || showReviewWarnings,
    warningBanner: showReviewWarnings && warningCount > 0,
    emptyState: !isReviewOutcome || showReviewWarnings,
  };
}
