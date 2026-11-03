import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import db from './db.ts';
import { calculateCashflow, calculateCategoryBreakdown } from '../utils/finance.ts';
import { calcHealthScore } from '../shared/healthScore.ts';
import { GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_TIMEOUT_MS, GEMINI_MAX_RETRIES } from './config.ts';

function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

/**
 * Gathers user financial context from SQLite to feed into the prompt as verified facts.
 */
export function getUserFinancialContext(userId: number) {
  const transactions = db.prepare(`
    SELECT id, transaction_type, amount, category, description, payment_method, status, created_at, paypal_order_id, is_demo
    FROM transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as any[];

  if (transactions.length === 0) {
    return {
      hasData: false,
      summaryText: 'VERIFIED FACTS: The user currently has 0 recorded transactions in their SQLite database. Total Income: $0.00, Total Expenses: $0.00, Net Savings: $0.00, Categories: None.',
      transactions: [],
      cashflow: { totalIncome: 0, totalExpenses: 0, netSavings: 0, savingsRate: 0, totalTransactions: 0 },
      breakdown: [],
      health: { score: 50, rating: 'New Account', factors: [] },
    };
  }

  const cashflow = calculateCashflow(transactions);
  const breakdown = calculateCategoryBreakdown(transactions);
  const health = calcHealthScore(
    cashflow.totalIncome,
    cashflow.totalExpenses,
    transactions.length,
    breakdown.length
  );

  const recentList = transactions.slice(0, 15).map((t) => 
    `- [${t.created_at ? t.created_at.substring(0, 10) : 'Recent'}] ${t.transaction_type.toUpperCase()} $${t.amount.toFixed(2)} | Category: ${t.category} | Method: ${t.payment_method} | Desc: ${t.description}${t.paypal_order_id ? ' (PayPal Verified)' : ''}${t.is_demo ? ' [Sample Data]' : ''}`
  ).join('\n');

  const categoryList = breakdown.map((b) => 
    `- ${b.category}: $${b.amount.toFixed(2)} (${b.percentage}% of total expenses, ${b.count} transactions)`
  ).join('\n');

  const summaryText = `
VERIFIED USER FINANCIAL FACTS (AUTHENTICATED FROM SQLITE DATABASE):
- Total Income: $${cashflow.totalIncome.toFixed(2)}
- Total Expenses: $${cashflow.totalExpenses.toFixed(2)}
- Net Monthly Savings: $${cashflow.netSavings.toFixed(2)}
- Current Savings Rate: ${cashflow.savingsRate}%
- Financial Health Score: ${health.score}/100 (${health.rating})
- Total Transactions Logged: ${transactions.length}

CATEGORY EXPENSE TOTALS:
${categoryList || 'No expenses logged ($0.00)'}

RECENT TRANSACTIONS:
${recentList}
`;

  return {
    hasData: true,
    summaryText,
    transactions,
    cashflow,
    breakdown,
    health,
  };
}

export interface ChatRequest {
  userId: number;
  question?: string;
  message?: string;
}

// In-memory cache for models that have exhausted their daily quotas (cooling down)
const modelCooldowns = new Map<string, number>();

// 10-minute AI answer cache keyed by question + hash of SQLite ledger data
interface CacheEntry {
  answer: string;
  timestamp: number;
}
const aiAnswerCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function computeLedgerHash(transactions: any[], cashflow: any, health: any): string {
  const payload = JSON.stringify({
    count: transactions.length,
    recentIds: transactions.slice(0, 5).map((t: any) => t.id),
    income: cashflow.totalIncome,
    expenses: cashflow.totalExpenses,
    savings: cashflow.netSavings,
    score: health.score,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Executes a promise with an enforced timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationLabel: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${operationLabel} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Checks whether an error is a daily quota exhaustion (e.g. Free Tier 20 requests/day).
 * Retrying the same model for daily quota exhaustion is futile and will waste seconds.
 */
function isDailyQuotaExhausted(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('per day limit exceeded') ||
    msg.includes('daily limit') ||
    msg.includes('generaterequestsperday') ||
    msg.includes('free tier requests, limit:') ||
    msg.includes('free_tier_requests') ||
    msg.includes('resource_exhausted')
  ) {
    return true;
  }
  const details = err.details || (err.error && err.error.details);
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d.retryDelay && parseInt(d.retryDelay, 10) > 60) return true;
      if (d.quotaId && d.quotaId.toLowerCase().includes('perday')) return true;
      if (d.violations) {
        for (const v of d.violations) {
          if (v.quotaId && v.quotaId.toLowerCase().includes('perday')) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks whether an error is transient (503, 429 rate limit, network error, timeout).
 */
function isRetryableError(err: any): boolean {
  if (!err) return false;
  // If the model exhausted its daily per-model quota, retrying on the SAME model within seconds will never succeed
  if (isDailyQuotaExhausted(err)) {
    return false;
  }
  const status = err.status || err.statusCode || (err.response && err.response.status);
  // Non-retryable client errors: 400, 401, 403, 404
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }
  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('no longer available') ||
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied')
  ) {
    return false;
  }
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  );
}

/**
 * Calls Gemini model with retry and exponential backoff (1s, 2s, 4s; max 3 attempts).
 */
async function callModelWithRetry(
  ai: GoogleGenAI,
  modelName: string,
  promptContent: string,
  systemInstruction: string,
  question: string,
  userId: number
): Promise<string> {
  const backoffDelays = [1000, 2000, 4000]; // 1s, 2s, 4s

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    console.log(`[AI Advisor] Question received: "${question.substring(0, 80)}" | User ID: ${userId}`);
    console.log(`[AI Advisor] Model used: ${modelName} | Attempt: ${attempt}/${GEMINI_MAX_RETRIES}`);

    try {
      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: promptContent,
        config: {
          systemInstruction,
        },
      });

      const response = await withTimeout(
        generatePromise,
        GEMINI_TIMEOUT_MS,
        `Gemini (${modelName}) attempt ${attempt}`
      );

      const answerText = response.text?.trim();
      if (!answerText) {
        throw new Error('Gemini API returned an empty response');
      }

      console.log(`[AI Advisor] Success: Model ${modelName} succeeded on attempt ${attempt}`);
      return answerText;
    } catch (err: any) {
      const status = err.status || err.statusCode || (err.response && err.response.status) || 'NETWORK/TIMEOUT_ERROR';

      if (isDailyQuotaExhausted(err)) {
        // Daily free tier quota exhausted for this model. Cooldown for 24h to avoid hitting it again.
        modelCooldowns.set(modelName, Date.now() + 24 * 60 * 60 * 1000);
        console.warn(`[AI Advisor] Model ${modelName} reached daily quota (Status: ${status}). Cooling down for 24 hours; fast-failing to fallback model.`);
        break;
      }

      console.warn(`[AI Advisor] Attempt ${attempt}/${GEMINI_MAX_RETRIES} failed for model ${modelName} | Status: ${status} | Error: ${err.message || err}`);

      const retryable = isRetryableError(err);
      if (attempt < GEMINI_MAX_RETRIES && retryable) {
        const delay = backoffDelays[attempt - 1] || 1000;
        console.log(`[AI Advisor] Backoff: Waiting ${delay}ms before next attempt...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        if (!retryable) {
          console.warn(`[AI Advisor] Non-retryable error (status ${status}) on model ${modelName}. Aborting retries to allow fast fallback.`);
        }
        break;
      }
    }
  }

  throw new Error(`Model ${modelName} failed after attempts.`);
}

/**
 * Generates financial assistant response using Google Gemini API.
 * Orchestrates primary model -> retry with backoff -> fallback model -> retry with backoff.
 */
export async function getAiFinancialAdvice(req: ChatRequest): Promise<string> {
  const userId = req.userId;
  const question = (req.question || req.message || '').trim();

  if (!question) {
    throw new Error('Question cannot be empty.');
  }

  const ai = getAiClient();
  if (!ai) {
    console.warn(`[AI Advisor] GEMINI_API_KEY is not configured or missing.`);
    const err: any = new Error("The AI is busy right now, please try again.");
    err.status = 503;
    throw err;
  }

  const context = getUserFinancialContext(userId);

  // Check 10-minute in-memory response cache keyed by question + hash of ledger data
  const ledgerHash = computeLedgerHash(context.transactions, context.cashflow, context.health);
  const normalizedQuestion = question.trim().toLowerCase();
  const cacheKey = `${userId}:${ledgerHash}:${normalizedQuestion}`;

  const cached = aiAnswerCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    console.info(`[AI Advisor] Cache hit for user ${userId} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
    return cached.answer;
  }

  const systemInstruction = `
You are PaySmart AI, an elite personal financial advisor and spending analyst for the PayPal AI Hackathon.
You have direct access to the user's authentic financial records from their SQLite database.

CRITICAL INSTRUCTIONS:
1. Always base your advice and calculations on the verified financial facts provided in the prompt.
2. Use ONLY these numbers, never recalculate or invent figures.
3. Directly answer the user's question with clarity, professionalism, and actionable financial steps.
4. Reference their verified figures (total income: $${context.cashflow.totalIncome.toFixed(2)}, total expenses: $${context.cashflow.totalExpenses.toFixed(2)}, net savings: $${context.cashflow.netSavings.toFixed(2)}, savings rate: ${context.cashflow.savingsRate}%, financial health score: ${context.health.score}/100).
5. If the user has 0 transactions or no data, state that clearly and suggest adding expenses or exploring demo transactions.
6. Format your response cleanly using Markdown with **bold** key figures and bullet points for readability.
7. Never fabricate or hallucinate numbers outside their verified records.
`;

  const promptContent = `
${context.summaryText}

USER QUESTION:
"${question}"

Provide a thorough, data-grounded, and insightful answer based on the verified facts above. Use ONLY these numbers, never recalculate or invent figures.
`;

  const now = Date.now();
  const primaryCooldown = modelCooldowns.get(GEMINI_MODEL) || 0;
  const isPrimaryAvailable = primaryCooldown <= now;

  // Step 1: Try Primary Model (if available and not cooling down)
  if (isPrimaryAvailable) {
    try {
      const answer = await callModelWithRetry(
        ai,
        GEMINI_MODEL,
        promptContent,
        systemInstruction,
        question,
        userId
      );

      // Save to 10-minute cache
      aiAnswerCache.set(cacheKey, {
        answer,
        timestamp: Date.now(),
      });

      // Save to SQLite chat history
      try {
        db.prepare('INSERT INTO ai_chat_history (user_id, message, response) VALUES (?, ?, ?)').run(
          userId,
          question,
          answer
        );
      } catch (dbErr) {
        console.warn('[AI Advisor] Failed to save chat history to SQLite:', dbErr);
      }

      return answer;
    } catch (primaryErr: any) {
      console.warn(`[AI Advisor] Primary model ${GEMINI_MODEL} exhausted retries: ${primaryErr.message}`);
      console.log(`[AI Advisor] Initiating fallback to model: ${GEMINI_FALLBACK_MODEL}`);
    }
  } else {
    console.info(`[AI Advisor] Primary model ${GEMINI_MODEL} is currently in daily quota cooldown. Routing directly to fallback model: ${GEMINI_FALLBACK_MODEL}`);
  }

  // Step 2: Try Fallback Models
  const fallbackCandidates = [
    GEMINI_FALLBACK_MODEL,
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
  ].filter((m, idx, self) => m !== GEMINI_MODEL && self.indexOf(m) === idx);

  for (const fallbackModel of fallbackCandidates) {
    const fallbackCooldown = modelCooldowns.get(fallbackModel) || 0;
    if (fallbackCooldown > Date.now()) {
      console.info(`[AI Advisor] Skipping fallback model ${fallbackModel} (currently cooling down).`);
      continue;
    }

    try {
      console.log(`[AI Advisor] Attempting fallback model: ${fallbackModel}`);
      const fallbackAnswer = await callModelWithRetry(
        ai,
        fallbackModel,
        promptContent,
        systemInstruction,
        question,
        userId
      );

      // Save to 10-minute cache
      aiAnswerCache.set(cacheKey, {
        answer: fallbackAnswer,
        timestamp: Date.now(),
      });

      // Save to SQLite chat history
      try {
        db.prepare('INSERT INTO ai_chat_history (user_id, message, response) VALUES (?, ?, ?)').run(
          userId,
          question,
          fallbackAnswer
        );
      } catch (dbErr) {
        console.warn('[AI Advisor] Failed to save chat history to SQLite:', dbErr);
      }

      return fallbackAnswer;
    } catch (fallbackErr: any) {
      console.warn(`[AI Advisor] Fallback model ${fallbackModel} failed: ${fallbackErr.message || fallbackErr}`);
    }
  }

  console.warn(`[AI Advisor] All Gemini models exhausted.`);
  const err: any = new Error("The AI is busy right now, please try again.");
  err.status = 503;
  throw err;
}

/**
 * Generates automated proactive spending insights and recommendations for dashboard.
 */
export async function getAutomatedFinancialInsights(userId: number) {
  const context = getUserFinancialContext(userId);

  if (!context.hasData) {
    return {
      score: 50,
      rating: 'New Account',
      summary: 'Start by logging your daily expenses or making a PayPal payment to unlock customized AI spending intelligence.',
      recommendations: [
        { title: 'Add your regular monthly income', impact: 'High', category: 'Income' },
        { title: 'Track recurring subscription bills', impact: 'Medium', category: 'Bills' },
        { title: 'Test PayPal Sandbox checkout', impact: 'High', category: 'Payments' },
      ],
    };
  }

  const ai = getAiClient();
  const topCat = context.breakdown[0] || { category: 'Living', amount: 0, percentage: 0 };

  if (ai) {
    const prompt = `
Generate a quick 3-bullet executive financial diagnostic for this user based on their verified numbers:
Income: $${context.cashflow?.totalIncome}
Expenses: $${context.cashflow?.totalExpenses}
Savings Rate: ${context.cashflow?.savingsRate}%
Category breakdown: ${JSON.stringify(context.breakdown)}

Return a concise summary and 3 distinct recommendations (High/Medium impact).
`;

    const now = Date.now();
    const insightCandidates = [
      GEMINI_MODEL,
      GEMINI_FALLBACK_MODEL,
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
    ].filter((m, idx, self) => self.indexOf(m) === idx && (modelCooldowns.get(m) || 0) <= now);

    for (const model of insightCandidates) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: "You are an automated financial insights generator. Be concise, direct, and data-driven.",
          },
        });

        if (response.text?.trim()) {
          return {
            score: context.health?.score,
            rating: context.health?.rating,
            summary: response.text.trim(),
            recommendations: [
              {
                title: `Review ${topCat.category} Expenses`,
                description: `This category accounts for ${topCat.percentage}% of your total outflow ($${topCat.amount.toFixed(2)}).`,
                impact: 'High',
                category: topCat.category,
              },
              {
                title: 'Strengthen Savings Buffer',
                description: `Your current savings rate is ${context.cashflow?.savingsRate}%. Target at least 20% consistent monthly savings.`,
                impact: 'Medium',
                category: 'Savings',
              },
              {
                title: 'Track Verified PayPal Outlays',
                description: 'Leverage PayPal digital receipts for automated tax and business expense documentation.',
                impact: 'Medium',
                category: 'Payments',
              },
            ],
          };
        }
      } catch (err: any) {
        // Quietly try next model if quota or error encountered
        const status = err.status || err.statusCode || (err.response && err.response.status) || 'ERROR';
        if (isDailyQuotaExhausted(err)) {
          modelCooldowns.set(model, Date.now() + 24 * 60 * 60 * 1000);
        }
        console.info(`[AI Advisor] Automated insights for model ${model} skipped (${status}). Trying next candidate...`);
      }
    }
  }

  // Authentic rule-based financial intelligence grounded in SQLite ledger
  return {
    score: context.health?.score || 85,
    rating: context.health?.rating || 'Strong',
    summary: `Your total income is $${context.cashflow?.totalIncome.toFixed(2)} with expenses of $${context.cashflow?.totalExpenses.toFixed(2)}, leaving a net positive monthly savings of $${context.cashflow?.netSavings.toFixed(2)} (${context.cashflow?.savingsRate}% savings rate). Top category: ${topCat.category} ($${topCat.amount.toFixed(2)}).`,
    recommendations: [
      {
        title: `Optimize ${topCat.category} Outflow`,
        description: `You spent $${topCat.amount.toFixed(2)} on ${topCat.category}. Review charges to retain an extra 5-10% of monthly income.`,
        impact: 'High',
        category: topCat.category,
      },
      {
        title: 'Centralize Subscriptions via PayPal',
        description: 'Manage recurring services through PayPal for streamlined cancellation, dispute management, and spend tracking.',
        impact: 'Medium',
        category: 'Payments',
      },
      {
        title: 'Emergency Liquid Reserve',
        description: `With $${context.cashflow?.netSavings.toFixed(2)} in surplus cashflow, allocate funds toward 3-6 months of essential living expenses.`,
        impact: 'High',
        category: 'Savings',
      },
    ],
  };
}

/**
 * Diagnostic health check for Gemini AI (/api/ai/health).
 * Performs a lightweight generation test and returns { ok, model } or { ok: false, model, error }.
 */
export async function checkAiHealth(): Promise<{ ok: boolean; model: string; error?: string }> {
  const ai = getAiClient();
  if (!ai) {
    return { ok: false, model: GEMINI_MODEL, error: 'GEMINI_API_KEY is not configured or missing' };
  }

  const now = Date.now();
  const candidateModels = [
    (modelCooldowns.get(GEMINI_MODEL) || 0) <= now ? GEMINI_MODEL : null,
    GEMINI_FALLBACK_MODEL,
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
  ].filter(Boolean) as string[];

  let lastError = '';
  let testedModel = candidateModels[0] || GEMINI_FALLBACK_MODEL;

  for (const model of candidateModels) {
    testedModel = model;
    try {
      const res = await withTimeout(
        ai.models.generateContent({
          model,
          contents: 'Say OK',
        }),
        8000,
        `Gemini Health Ping (${model})`
      );

      if (res.text !== undefined) {
        return { ok: true, model };
      }
    } catch (err: any) {
      if (isDailyQuotaExhausted(err)) {
        modelCooldowns.set(model, Date.now() + 24 * 60 * 60 * 1000);
      }
      lastError = err.message || String(err);
    }
  }

  return { ok: false, model: testedModel, error: lastError };
}

