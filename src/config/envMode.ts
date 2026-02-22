
export type EnvMode = "production" | "staging" | "development";

export function resolveEnvMode(): EnvMode {
  // Check overrides first
  const override = (import.meta as any).env?.VITE_ENV_MODE_OVERRIDE || 
                   (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_ENV_MODE_OVERRIDE : "") || 
                   "";

  const vOverride = override.toLowerCase();
  if (vOverride === "production" || vOverride === "prod") return "production";
  if (vOverride === "staging" || vOverride === "stage") return "staging";
  if (vOverride === "development" || vOverride === "dev") return "development";

  // Check standard Vite/Next environment variables
  const mode = (import.meta as any).env?.MODE || 
               (typeof process !== 'undefined' ? process.env?.NODE_ENV : "") || 
               "";
               
  const v = (mode || "").toLowerCase();

  if (v === "production" || v === "prod") return "production";
  if (v === "staging" || v === "stage" || v === "preview") return "staging";
  
  return "development";
}

export const getEnvMode = resolveEnvMode;
