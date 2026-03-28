import type { AuthConfig } from "convex/server";

const workosClientId = process.env.WORKOS_CLIENT_ID;

const providers = workosClientId
  ? [
      {
        type: "customJwt" as const,
        applicationID: workosClientId,
        issuer: "https://api.workos.com/",
        jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
        algorithm: "RS256" as const,
      },
    ]
  : [];

export default {
  providers,
} satisfies AuthConfig;
