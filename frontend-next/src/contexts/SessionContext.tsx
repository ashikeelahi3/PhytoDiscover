"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getSession, updateDisplayName } from "@/lib/api";
import type { Session } from "@/lib/types";

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  setDisplayName: (name: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  setDisplayName: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const setDisplayName = useCallback(async (name: string) => {
    const updated = await updateDisplayName(name);
    setSession(updated);
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading, setDisplayName }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
