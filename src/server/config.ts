/**
 * Server-side AI configuration constants.
 * Single source of truth for Gemini model names and fallback settings.
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
export const GEMINI_TIMEOUT_MS = 25000; // 25 seconds timeout per attempt
export const GEMINI_MAX_RETRIES = 3;
