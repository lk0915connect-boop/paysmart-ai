/**
 * Pure financial utility functions for calculations, analytics, and metrics.
 * Decoupled from UI components for pure testability and deterministic assertions.
 */

export interface TransactionSummaryItem {
  id?: number | string;
  transaction_type: 'income' | 'expense';
  amount: number;
  category: string;
  created_at?: string;
  payment_method?: string;
}

export interface CashflowSummary {
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  savingsRate: number; // percentage 0 - 100
  totalTransactions: number;
}

export interface CategorySummary {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

/**
 * Calculates net balance, total income, total expenses, and savings rate.
 */
export function calculateCashflow(transactions: TransactionSummaryItem[]): CashflowSummary {
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of transactions) {
    const val = Number(t.amount) || 0;
    if (t.transaction_type === 'income') {
      totalIncome += val;
    } else {
      totalExpenses += val;
    }
  }

  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.round(((totalIncome - totalExpenses) / totalIncome) * 100)) : 0;

  return {
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    netSavings: Math.round(netSavings * 100) / 100,
    savingsRate,
    totalTransactions: transactions.length,
  };
}

/**
 * Aggregates expenses by category with amounts and percentages.
 */
export function calculateCategoryBreakdown(transactions: TransactionSummaryItem[]): CategorySummary[] {
  const expenses = transactions.filter((t) => t.transaction_type === 'expense');
  const totalExpense = expenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const categoryMap = new Map<string, { amount: number; count: number }>();

  for (const t of expenses) {
    const cat = t.category || 'Other';
    const current = categoryMap.get(cat) || { amount: 0, count: 0 };
    categoryMap.set(cat, {
      amount: current.amount + (Number(t.amount) || 0),
      count: current.count + 1,
    });
  }

  const results: CategorySummary[] = [];
  for (const [category, data] of categoryMap.entries()) {
    const percentage = totalExpense > 0 ? Math.round((data.amount / totalExpense) * 1000) / 10 : 0;
    results.push({
      category,
      amount: Math.round(data.amount * 100) / 100,
      percentage,
      count: data.count,
    });
  }

  return results.sort((a, b) => b.amount - a.amount);
}

export { calcHealthScore, calculateFinancialHealthScore } from '../shared/healthScore.ts';

/**
 * Formats monetary amounts with specified currency symbol.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  const currencySymbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
    AUD: 'A$',
    JPY: '¥',
  };

  const symbol = currencySymbols[currency] || '$';
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${amount < 0 ? '-' : ''}${symbol}${formatted}`;
}
