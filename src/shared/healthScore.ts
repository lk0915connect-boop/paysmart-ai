/**
 * Shared Financial Health Score calculator.
 * Single source of truth used across Dashboard, Sidebar, and Server-side AI prompts.
 *
 * Proprietary Financial Health Score (0 - 100) based on:
 * - Savings rate (40% weight)
 * - Expense-to-income ratio (30% weight)
 * - Category diversification (15% weight)
 * - Activity continuity (15% weight)
 */

export interface HealthScoreResult {
  score: number;
  rating: 'Excellent' | 'Good' | 'Fair' | 'Needs Attention';
  color: string;
  factors?: string[];
}

export function calcHealthScore(
  income: number,
  expenses: number,
  transactionsCount: number,
  categoryCount: number
): HealthScoreResult {
  if (income <= 0 && expenses <= 0) {
    return { score: 50, rating: 'Fair', color: '#F59E0B' };
  }

  // 1. Savings rate component (0 - 40 points)
  const savingsRate = income > 0 ? (income - expenses) / income : 0;
  let savingsPoints = 0;
  if (savingsRate >= 0.3) savingsPoints = 40;
  else if (savingsRate >= 0.2) savingsPoints = 35;
  else if (savingsRate >= 0.1) savingsPoints = 25;
  else if (savingsRate > 0) savingsPoints = 15;
  else savingsPoints = 5;

  // 2. Expense coverage ratio (0 - 30 points)
  let ratioPoints = 0;
  const expenseRatio = income > 0 ? expenses / income : 1.5;
  if (expenseRatio <= 0.5) ratioPoints = 30;
  else if (expenseRatio <= 0.7) ratioPoints = 25;
  else if (expenseRatio <= 0.85) ratioPoints = 18;
  else if (expenseRatio <= 1.0) ratioPoints = 10;
  else ratioPoints = 2;

  // 3. Category diversity (0 - 15 points)
  const diversityPoints = Math.min(15, categoryCount * 3);

  // 4. Transaction logging continuity (0 - 15 points)
  const activityPoints = Math.min(15, transactionsCount >= 5 ? 15 : transactionsCount * 3);

  const rawScore = Math.min(100, Math.max(10, savingsPoints + ratioPoints + diversityPoints + activityPoints));

  let rating: 'Excellent' | 'Good' | 'Fair' | 'Needs Attention' = 'Fair';
  let color = '#F59E0B';

  if (rawScore >= 80) {
    rating = 'Excellent';
    color = '#10B981';
  } else if (rawScore >= 65) {
    rating = 'Good';
    color = '#0070BA';
  } else if (rawScore >= 45) {
    rating = 'Fair';
    color = '#F59E0B';
  } else {
    rating = 'Needs Attention';
    color = '#EF4444';
  }

  return { score: rawScore, rating, color };
}

// Alias for backwards compatibility
export const calculateFinancialHealthScore = calcHealthScore;
