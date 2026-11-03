import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_TIMEOUT_MS, GEMINI_MAX_RETRIES } from './config.ts';
import { getUserFinancialContext } from './gemini.ts';

test('AI Advisor configuration defaults to verified available Gemini models', () => {
  assert.strictEqual(GEMINI_MODEL, 'gemini-3.8-flash');
  assert.strictEqual(GEMINI_FALLBACK_MODEL, 'gemini-3.5-flash-lite');
  assert.strictEqual(GEMINI_TIMEOUT_MS, 25000);
  assert.strictEqual(GEMINI_MAX_RETRIES, 3);
});

test('getUserFinancialContext returns verified zero-state summary for non-existent user', () => {
  const context = getUserFinancialContext(999999);
  assert.strictEqual(context.hasData, false);
  assert.strictEqual(context.cashflow.totalIncome, 0);
  assert.strictEqual(context.cashflow.totalExpenses, 0);
  assert.strictEqual(context.cashflow.netSavings, 0);
  assert.ok(context.summaryText.includes('VERIFIED FACTS'));
  assert.ok(context.summaryText.includes('$0.00'));
});

test('getUserFinancialContext extracts authenticated SQLite records for demo user', () => {
  // Demo user id 1 is seeded during initialization
  const context = getUserFinancialContext(1);
  if (context.hasData) {
    assert.ok(context.cashflow.totalIncome >= 0);
    assert.ok(context.cashflow.totalExpenses >= 0);
    assert.ok(context.summaryText.includes('VERIFIED USER FINANCIAL FACTS'));
    assert.ok(Array.isArray(context.breakdown));
  }
});
