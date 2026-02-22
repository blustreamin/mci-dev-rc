
import { BenchmarkSnapshot } from './types';

// BENCHMARK CERTIFICATION REPORT V3.1
// Executed: 15 Jan 2026
// Runs per Category: 50
// Status: STALE — Fabricated data, not from real deterministic runs
// Source Logic: Deterministic HHI & Weighted Intent (Methodology v3.0.0)
//
// ⚠️  WARNING: This file contains fabricated benchmark data from a manual upload.
// All maxVariancePct.demandIndexMn values are hardcoded to 15.00 and stdev values are rounded estimates.
// This file will be replaced after running a clean 25x benchmark with calibration disabled.
// See: metricsCalculatorV3.ts CALIBRATION_DISABLED comments for context.

export const CERTIFIED_BENCHMARK: BenchmarkSnapshot = {
  snapshotVersion: "v3",
  createdAtISO: "2026-01-15T12:00:00.000Z",
  expiresAtISO: "2027-01-15T12:00:00.000Z",
  registryHash: "v3.1-certification-run-50x-deployment", 
  keywordBaseHash: "locked-strategy-v3.1",
  iterations: 50,
  status: "SUCCESS",
  categories: {
    "shaving": {
      categoryId: "shaving",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 4.35, readinessScore: 7.60, spreadScore: 6.40 },
      median: { demandIndexMn: 4.32, readinessScore: 7.60, spreadScore: 6.40 },
      stdev: { demandIndexMn: 0.120, readinessScore: 0.100, spreadScore: 0.200 },
      min: { demandIndexMn: 4.15, readinessScore: 7.40, spreadScore: 6.00 },
      max: { demandIndexMn: 4.60, readinessScore: 7.80, spreadScore: 6.80 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.6, spreadScore: 6.2 },
      keywordBasis: []
    },
    "beard": {
      categoryId: "beard",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 2.90, readinessScore: 7.00, spreadScore: 5.30 },
      median: { demandIndexMn: 2.88, readinessScore: 7.00, spreadScore: 5.30 },
      stdev: { demandIndexMn: 0.150, readinessScore: 0.200, spreadScore: 0.150 },
      min: { demandIndexMn: 2.70, readinessScore: 6.60, spreadScore: 5.00 },
      max: { demandIndexMn: 3.15, readinessScore: 7.40, spreadScore: 5.60 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 5.7, spreadScore: 5.6 },
      keywordBasis: []
    },
    "hair-styling": {
      categoryId: "hair-styling",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 3.55, readinessScore: 7.30, spreadScore: 6.00 },
      median: { demandIndexMn: 3.52, readinessScore: 7.30, spreadScore: 6.00 },
      stdev: { demandIndexMn: 0.200, readinessScore: 0.150, spreadScore: 0.200 },
      min: { demandIndexMn: 3.25, readinessScore: 7.00, spreadScore: 5.60 },
      max: { demandIndexMn: 3.95, readinessScore: 7.60, spreadScore: 6.40 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 4.1, spreadScore: 6.6 },
      keywordBasis: []
    },
    "sexual-wellness": {
      categoryId: "sexual-wellness",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 3.30, readinessScore: 9.10, spreadScore: 4.40 },
      median: { demandIndexMn: 3.28, readinessScore: 9.10, spreadScore: 4.40 },
      stdev: { demandIndexMn: 0.250, readinessScore: 0.100, spreadScore: 0.300 },
      min: { demandIndexMn: 2.95, readinessScore: 8.90, spreadScore: 3.80 },
      max: { demandIndexMn: 3.75, readinessScore: 9.30, spreadScore: 5.00 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.2, spreadScore: 13.6 },
      keywordBasis: []
    },
    "intimate-hygiene": {
      categoryId: "intimate-hygiene",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 1.90, readinessScore: 6.40, spreadScore: 5.70 },
      median: { demandIndexMn: 1.88, readinessScore: 6.40, spreadScore: 5.70 },
      stdev: { demandIndexMn: 0.100, readinessScore: 0.200, spreadScore: 0.200 },
      min: { demandIndexMn: 1.75, readinessScore: 6.00, spreadScore: 5.30 },
      max: { demandIndexMn: 2.10, readinessScore: 6.80, spreadScore: 6.10 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 6.2, spreadScore: 7.0 },
      keywordBasis: []
    },
    "hair-colour": {
      categoryId: "hair-colour",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 5.25, readinessScore: 5.70, spreadScore: 7.20 },
      median: { demandIndexMn: 5.22, readinessScore: 5.70, spreadScore: 7.20 },
      stdev: { demandIndexMn: 0.150, readinessScore: 0.100, spreadScore: 0.100 },
      min: { demandIndexMn: 5.00, readinessScore: 5.50, spreadScore: 7.00 },
      max: { demandIndexMn: 5.50, readinessScore: 5.90, spreadScore: 7.40 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 3.5, spreadScore: 2.8 },
      keywordBasis: []
    },
    "face-care": {
      categoryId: "face-care",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 6.15, readinessScore: 8.30, spreadScore: 8.00 },
      median: { demandIndexMn: 6.10, readinessScore: 8.30, spreadScore: 8.00 },
      stdev: { demandIndexMn: 0.300, readinessScore: 0.100, spreadScore: 0.150 },
      min: { demandIndexMn: 5.75, readinessScore: 8.10, spreadScore: 7.70 },
      max: { demandIndexMn: 6.65, readinessScore: 8.50, spreadScore: 8.30 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.4, spreadScore: 3.8 },
      keywordBasis: []
    },
    "deodorants": {
      categoryId: "deodorants",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 7.55, readinessScore: 8.00, spreadScore: 8.40 },
      median: { demandIndexMn: 7.50, readinessScore: 8.00, spreadScore: 8.40 },
      stdev: { demandIndexMn: 0.350, readinessScore: 0.100, spreadScore: 0.100 },
      min: { demandIndexMn: 7.05, readinessScore: 7.80, spreadScore: 8.20 },
      max: { demandIndexMn: 8.15, readinessScore: 8.20, spreadScore: 8.60 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.5, spreadScore: 2.4 },
      keywordBasis: []
    },
    "hair-oil": {
      categoryId: "hair-oil",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 4.65, readinessScore: 6.60, spreadScore: 7.00 },
      median: { demandIndexMn: 4.62, readinessScore: 6.60, spreadScore: 7.00 },
      stdev: { demandIndexMn: 0.200, readinessScore: 0.150, spreadScore: 0.150 },
      min: { demandIndexMn: 4.35, readinessScore: 6.30, spreadScore: 6.70 },
      max: { demandIndexMn: 5.00, readinessScore: 6.90, spreadScore: 7.30 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 4.5, spreadScore: 4.3 },
      keywordBasis: []
    },
    "fragrance-premium": {
      categoryId: "fragrance-premium",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 2.55, readinessScore: 8.40, spreadScore: 5.40 },
      median: { demandIndexMn: 2.52, readinessScore: 8.40, spreadScore: 5.40 },
      stdev: { demandIndexMn: 0.180, readinessScore: 0.100, spreadScore: 0.200 },
      min: { demandIndexMn: 2.25, readinessScore: 8.20, spreadScore: 5.00 },
      max: { demandIndexMn: 2.90, readinessScore: 8.60, spreadScore: 5.80 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.4, spreadScore: 7.4 },
      keywordBasis: []
    },
    "skincare-spec": {
      categoryId: "skincare-spec",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 1.95, readinessScore: 8.70, spreadScore: 5.00 },
      median: { demandIndexMn: 1.92, readinessScore: 8.70, spreadScore: 5.00 },
      stdev: { demandIndexMn: 0.120, readinessScore: 0.100, spreadScore: 0.200 },
      min: { demandIndexMn: 1.75, readinessScore: 8.50, spreadScore: 4.60 },
      max: { demandIndexMn: 2.20, readinessScore: 8.90, spreadScore: 5.40 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 2.3, spreadScore: 8.0 },
      keywordBasis: []
    },
    "shampoo": {
      categoryId: "shampoo",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 5.65, readinessScore: 6.20, spreadScore: 7.70 },
      median: { demandIndexMn: 5.60, readinessScore: 6.20, spreadScore: 7.70 },
      stdev: { demandIndexMn: 0.250, readinessScore: 0.100, spreadScore: 0.100 },
      min: { demandIndexMn: 5.25, readinessScore: 6.00, spreadScore: 7.50 },
      max: { demandIndexMn: 6.15, readinessScore: 6.40, spreadScore: 7.90 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 3.2, spreadScore: 2.6 },
      keywordBasis: []
    },
    "soap": {
      categoryId: "soap",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 6.95, readinessScore: 6.00, spreadScore: 7.40 },
      median: { demandIndexMn: 6.90, readinessScore: 6.00, spreadScore: 7.40 },
      stdev: { demandIndexMn: 0.300, readinessScore: 0.100, spreadScore: 0.150 },
      min: { demandIndexMn: 6.45, readinessScore: 5.80, spreadScore: 7.10 },
      max: { demandIndexMn: 7.55, readinessScore: 6.20, spreadScore: 7.70 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 3.3, spreadScore: 4.0 },
      keywordBasis: []
    },
    "body-lotion": {
      categoryId: "body-lotion",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 3.35, readinessScore: 6.70, spreadScore: 6.20 },
      median: { demandIndexMn: 3.30, readinessScore: 6.70, spreadScore: 6.20 },
      stdev: { demandIndexMn: 0.200, readinessScore: 0.150, spreadScore: 0.150 },
      min: { demandIndexMn: 3.05, readinessScore: 6.40, spreadScore: 5.90 },
      max: { demandIndexMn: 3.75, readinessScore: 7.00, spreadScore: 6.50 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 4.5, spreadScore: 4.8 },
      keywordBasis: []
    },
    "talcum": {
      categoryId: "talcum",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 2.20, readinessScore: 5.40, spreadScore: 6.00 },
      median: { demandIndexMn: 2.18, readinessScore: 5.40, spreadScore: 6.00 },
      stdev: { demandIndexMn: 0.120, readinessScore: 0.100, spreadScore: 0.150 },
      min: { demandIndexMn: 2.00, readinessScore: 5.20, spreadScore: 5.70 },
      max: { demandIndexMn: 2.45, readinessScore: 5.60, spreadScore: 6.30 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 3.7, spreadScore: 5.0 },
      keywordBasis: []
    },
    "oral-care": {
      categoryId: "oral-care",
      iterations: 50,
      metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
      mean: { demandIndexMn: 6.25, readinessScore: 6.10, spreadScore: 8.10 },
      median: { demandIndexMn: 6.20, readinessScore: 6.10, spreadScore: 8.10 },
      stdev: { demandIndexMn: 0.250, readinessScore: 0.100, spreadScore: 0.100 },
      min: { demandIndexMn: 5.85, readinessScore: 5.90, spreadScore: 7.90 },
      max: { demandIndexMn: 6.75, readinessScore: 6.30, spreadScore: 8.30 },
      maxVariancePct: { demandIndexMn: 15.00, readinessScore: 3.3, spreadScore: 2.5 },
      keywordBasis: []
    }
  },
  global: {
    maxVariancePctAcrossAll: {
      demandIndexMn: 15.0,
      readinessScore: 5.0,
      spreadScore: 8.0
    }
  }
};
