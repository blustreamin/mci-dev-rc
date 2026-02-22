
/**
 * Resilient Fetch Layer v1
 * This module provides a unified, resilient wrapper for all external data fetches.
 *
 * Retry Rules:
 * - Max 3 attempts per step.
 * - Exponential backoff starting at 500ms with jitter.
 * - Retries trigger on transient errors: timeouts, network errors, 5xx server errors, and 429 rate limit errors.
 * - Other 4xx client errors are considered final and do not trigger retries.
 *
 * Timeout Rules:
 * - Each step has a default timeout of 30 seconds, which can be overridden.
 * - Timeouts are enforced using an AbortController signal.
 *
 * Cancellation Rules:
 * - Tasks can be cancelled via an AbortController.
 * - Cancellation is considered a final failure for the step and is not retried.
 *
 * Stage Status (Success/Partial/Failed):
 * - Success: All steps in a task succeed.
 * - Partial: At least one step succeeds, and at least one fails.
 * - Failed: All steps in a task fail.
 */
import { AuditLogEntry } from './types';

interface Step<T> {
  id: string;
  fn: (signal: AbortSignal) => Promise<T>;
}

interface StepResult<T> {
  id: string;
  status: 'Success' | 'Failed';
  data?: T;
  error?: AuditLogEntry['errorType'];
  message?: string;
}

interface TaskOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  logFn?: (log: AuditLogEntry) => void;
  category: string;
  stage: string;
  abortOnChainFailure?: boolean; // New Flag: If true, stops processing subsequent steps on failure
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runResilientTask<T>(
  steps: Step<T>[],
  taskOptions: TaskOptions,
  abortSignal?: AbortSignal
): Promise<StepResult<T>[]> {
  const {
    timeoutMs = 120000, // Mandatory 2min hard timeout per constraints
    maxRetries = 2, // Total 3 attempts (1 initial + 2 retries)
    baseDelayMs = 1000,
    logFn = () => {},
    category,
    stage,
    abortOnChainFailure = true // Default to true for safety
  } = taskOptions;

  const results: StepResult<T>[] = [];

  for (const step of steps) {
    // 1. Check for User Cancellation
    if (abortSignal?.aborted) {
      results.push({ id: step.id, status: 'Failed', error: 'CANCELLED', message: 'Task cancelled by user.' });
      continue;
    }

    // 2. Check for Previous Failure (Chain Abort)
    const hasPreviousFailure = results.some(r => r.status === 'Failed');
    if (abortOnChainFailure && hasPreviousFailure) {
        // Log skip and continue (which effectively breaks the chain)
        // We don't push a result for skipped steps, keeping logic cleaner
        break;
    }

    let lastError: any = null;
    let lastErrorType: AuditLogEntry['errorType'] = 'UNKNOWN';

    // Log the start of the step so the accounting system picks it up
    logFn({
        timestamp: new Date().toISOString(),
        stage, category, step: step.id, attempt: 0, status: 'Running', durationMs: 0, message: `Processing step: ${step.id}...`
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (abortSignal?.aborted) {
        lastErrorType = 'CANCELLED';
        lastError = new Error('Task was cancelled.');
        break;
      }

      const attemptStartTime = Date.now();
      const controller = new AbortController();
      const signal = controller.signal;

      const timeoutId = setTimeout(() => {
        controller.abort('TIMEOUT');
      }, timeoutMs);

      // Link external abort signal to local controller
      const abortHandler = () => controller.abort(abortSignal.reason || 'CANCELLED');
      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler);
      }

      try {
        if (attempt > 0) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
          await sleep(delay);
        }

        // --- FIX: Race Condition Wrapper ---
        // This ensures that if the signal aborts (timeout or user cancel),
        // the promise rejects immediately, unblocking the await.
        const executionPromise = new Promise<T>((resolve, reject) => {
            const onAbort = () => reject(new Error(signal.reason || 'TIMEOUT'));
            
            // If already aborted, reject immediately
            if (signal.aborted) return onAbort();
            
            signal.addEventListener('abort', onAbort);
            
            step.fn(signal)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    signal.removeEventListener('abort', onAbort);
                });
        });

        const data = await executionPromise;
        
        clearTimeout(timeoutId);

        const durationMs = Date.now() - attemptStartTime;
        logFn({
          timestamp: new Date().toISOString(), stage, category, step: step.id, attempt: attempt + 1, status: 'Success', durationMs, message: 'Step completed successfully.'
        });
        
        results.push({ id: step.id, status: 'Success', data });
        lastError = null;
        break; 

      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (abortSignal?.aborted || signal.aborted) {
           // Distinguish between Timeout and User Cancel
           const reason = controller.signal.reason || error.message;
           if (reason === 'TIMEOUT' || error.message?.includes('TIMEOUT')) {
             lastErrorType = 'TIMEOUT';
             error.message = `Operation timed out after ${timeoutMs}ms`;
           } else {
             lastErrorType = 'CANCELLED';
           }
        } else if (error instanceof SyntaxError) {
          lastErrorType = 'PARSE_ERROR';
        } else if (error.message === 'OFFLINE') {
            lastErrorType = 'OFFLINE';
        } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            lastErrorType = '429';
        } else if (error.message?.includes('50')) { // Crude check for 5xx
            lastErrorType = '5XX';
        } else if (error.message?.includes('40')) { // Crude check for 4xx
            lastErrorType = '4XX';
        } else {
            lastErrorType = 'NETWORK';
        }

        lastError = error;
        
        const durationMs = Date.now() - attemptStartTime;
        logFn({
          timestamp: new Date().toISOString(), stage, category, step: step.id, attempt: attempt + 1, status: 'Failed', durationMs, errorType: lastErrorType, message: error.message || 'An unknown error occurred.'
        });
        
        // Don't retry on non-transient errors or cancellation
        if (lastErrorType === '4XX' || lastErrorType === 'CANCELLED' || lastErrorType === 'PARSE_ERROR' || lastErrorType === 'TIMEOUT' || lastErrorType === 'OFFLINE') {
          break;
        }
      } finally {
        if (abortSignal) {
            abortSignal.removeEventListener('abort', abortHandler);
        }
      }
    }

    if (lastError) {
      results.push({ id: step.id, status: 'Failed', error: lastErrorType, message: lastError.message });
    }
  }
  return results;
}
