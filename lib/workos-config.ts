const WORKOS_REQUIRED_ENV_VARS = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
] as const;

export function isWorkosConfigured() {
  return WORKOS_REQUIRED_ENV_VARS.every((envVar) => {
    const value = process.env[envVar];
    return typeof value === "string" && value.trim().length > 0;
  });
}
