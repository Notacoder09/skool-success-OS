"use client";

import { useEffect, useRef } from "react";

// ADR-0006: auto-detect timezone from the browser on first authenticated
// session. Sends a single POST per page load and ignores subsequent
// updates within the same render — the server stores it idempotently.
export function TimezoneCapture({ initial }: { initial: string | null }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    let detected = "UTC";
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) detected = tz;
    } catch {
      // Browser doesn't support; we leave UTC and the creator can edit
      // the value in Settings later.
    }
    if (initial && initial === detected) {
      sent.current = true;
      return;
    }

    sent.current = true;
    void fetch("/api/me/timezone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: detected }),
      keepalive: true,
    });
  }, [initial]);

  return null;
}
