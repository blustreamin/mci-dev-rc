
// --- Demand Sweep Methodology Contract v3.0.0 ---
// This file acts as the Single Source of Truth for the Demand Sweep logic.
// It is frozen at runtime to prevent mutation.

// Fixed: root demandSweepContract.ts should import from ./types (root) not ./src/types
import { StabilityLock } from './types';

export interface MethodologyContract {
  methodologyVersion: string;
  status: 'FROZEN' | 'DRAFT';
  auditedRunsRequired: number;
  formulas: {
    demandIndex: string;
    engagementReadiness: string;
    demandSpread: string;
  };
  intentWeights: Record<string, number>;
  normalization: {
    readinessScale: [number, number];
    spreadScale: [number, number];
  };
  changePolicy: string;
  // Runtime State for Stability Lock
  stabilityLock: StabilityLock;
}

export const DEMAND_SWEEP_CONTRACT: MethodologyContract = {
  methodologyVersion: "v3.0.0",
  status: "FROZEN",
  auditedRunsRequired: 50, // Certified via 50x Back-Test
  formulas: {
    demandIndex: "Aggregated monthly search volume (India) for deduplicated canonical keyword families, weighted by intent, capped at max SAM, rounded to 1 decimal (Mn).",
    engagementReadiness: "Weighted average of intent volumes (Decision=1.0, Need=0.85, Problem=0.75, Habit=0.70, Aspirational=0.60, Discovery=0.55) + Commerciality Boost (max 0.12), normalized 1-10.",
    demandSpread: "Inverse Herfindahl-Hirschman Index (HHI) of anchor volume shares (1 - Σs^2), normalized 1-10 where 10 is perfect equity."
  },
  intentWeights: {
    'Decision': 1.00, 
    'Need': 0.85, 
    'Problem': 0.75, 
    'Habit': 0.70, 
    'Aspirational': 0.60, 
    'Discovery': 0.55
  },
  normalization: {
    readinessScale: [1, 10],
    spreadScale: [1, 10]
  },
  changePolicy: "Any changes require version bump + rerun 50-run back-test + new audit stamp.",
  stabilityLock: {
    active: true,
    approvedAt: "2024-05-20T12:00:00.000Z",
    expiresAt: "2025-05-20T12:00:00.000Z",
    approvedBacktestRunId: "v3-certification-run-50x",
    baselineMedians: {} // In a real db this would be populated, but we use the static CERTIFIED_BENCHMARK file for the frontend
  }
};

// Helper to update lock state (Simulated persistence)
export function updateStabilityLock(lock: StabilityLock) {
    // In a real app, this would persist to a backend. 
    // Here we update the in-memory object and assume App state persistence handles the rest via localStorage.
    DEMAND_SWEEP_CONTRACT.stabilityLock = lock;
}

// Deep freeze the contract structure (except the stabilityLock which is a state container we might swap entire refs of)
Object.freeze(DEMAND_SWEEP_CONTRACT.formulas);
Object.freeze(DEMAND_SWEEP_CONTRACT.intentWeights);
Object.freeze(DEMAND_SWEEP_CONTRACT.normalization);
