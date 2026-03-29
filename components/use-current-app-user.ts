"use client";

import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/api";

export function useCurrentAppUser() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const currentAppUser = useQuery(api.appUsers.getCurrent, isAuthenticated ? {} : "skip");
  const ensureCurrentAppUser = useMutation(api.appUsers.ensureCurrent);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const isEnsuringRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (
      isAuthLoading ||
      !isAuthenticated ||
      currentAppUser === undefined ||
      currentAppUser !== null ||
      isEnsuringRef.current ||
      bootstrapError
    ) {
      return;
    }

    isEnsuringRef.current = true;

    void ensureCurrentAppUser({})
      .catch((error) => {
        if (!cancelled) {
          setBootstrapError(
            error instanceof Error ? error.message : "Could not initialize your account.",
          );
        }
      })
      .finally(() => {
        isEnsuringRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapError,
    currentAppUser,
    ensureCurrentAppUser,
    isAuthenticated,
    isAuthLoading,
  ]);

  return {
    currentAppUser,
    isReady:
      !isAuthLoading && isAuthenticated && currentAppUser !== undefined && currentAppUser !== null,
    bootstrapError,
  };
}
