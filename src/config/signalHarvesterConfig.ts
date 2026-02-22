let overrideName: string | null = null;
let loggedOnce = false;

/**
 * Resolves the environment mode ("prod" | "staging") based on available environment variables.
 * Precedence: MCI_SIGNALS_ENV -> VITE_MCI_SIGNALS_ENV -> NEXT_PUBLIC_MCI_SIGNALS_ENV -> REACT_APP_MCI_SIGNALS_ENV
 */
export function getSignalHarvesterEnvResolved(): "prod" | "staging" {
  const env = (import.meta as any).env || {};
  const mode = env.MCI_SIGNALS_ENV || 
               env.VITE_MCI_SIGNALS_ENV || 
               env.NEXT_PUBLIC_MCI_SIGNALS_ENV || 
               env.REACT_APP_MCI_SIGNALS_ENV || 
               "prod";

  return mode === "staging" ? "staging" : "prod";
}

/**
 * Returns the effective collection name.
 * Priority: 1. Manual Override, 2. Env-based default.
 */
export function getSignalHarvesterCollectionName(): string {
  if (overrideName) return overrideName;

  const env = getSignalHarvesterEnvResolved();
  return env === "staging" ? "signal_harvester_staging" : "signal_harvester_v2";
}

/**
 * Named export alias for backward compatibility.
 */
export const getSignalHarvesterCollection = getSignalHarvesterCollectionName;

/**
 * Manually override the collection name for the current session.
 */
export function setSignalHarvesterCollectionOverride(name: string | null): void {
  overrideName = name;
  if (process.env.NODE_ENV === 'development') {
    console.log(`[MCI_SIGNALS] Session Override Active: ${name}`);
  }
}

/**
 * Clears any session-level collection override.
 */
export function clearSignalHarvesterCollectionOverride(): void {
  overrideName = null;
}

/**
 * Returns the current internal configuration state for diagnostics.
 */
export function __debugSignalHarvesterConfig(): { env: string; collection: string; override: string | null } {
  return {
    env: getSignalHarvesterEnvResolved(),
    collection: getSignalHarvesterCollectionName(),
    override: overrideName
  };
}

// Dev-only initialization log (fires once per boot)
if (!loggedOnce && process.env.NODE_ENV === 'development') {
  const config = __debugSignalHarvesterConfig();
  console.log(`[MCI_SIGNALS] boot_config env=${config.env} collection=${config.collection}`);
  loggedOnce = true;
}