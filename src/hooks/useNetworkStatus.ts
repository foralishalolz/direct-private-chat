"use client";

import { useEffect, useState } from "react";

export interface NetworkStatus {
  online: boolean;
  /** Effective connection type on supporting browsers (e.g. "2g", "3g"). */
  effectiveType: string | null;
  /** True when the connection is likely to feel sluggish. */
  slow: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: {
    effectiveType?: string;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
    saveData?: boolean;
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    online: true,
    effectiveType: null,
    slow: false,
  });

  useEffect(() => {
    const nav = navigator as NavigatorWithConnection;
    const connection = nav.connection;

    function read() {
      const effectiveType = connection?.effectiveType ?? null;
      const online = navigator.onLine;
      setStatus({
        online,
        effectiveType,
        slow:
          !online ||
          effectiveType === "slow-2g" ||
          effectiveType === "2g" ||
          Boolean(connection?.saveData),
      });
    }

    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    connection?.addEventListener?.("change", read);

    return () => {
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
      connection?.removeEventListener?.("change", read);
    };
  }, []);

  return status;
}
