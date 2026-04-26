"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { connectSkool, type ConnectResult } from "./actions";

export function SkoolConnectForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectResult | null>(null);

  function onSubmit(form: FormData) {
    startTransition(async () => {
      const r = await connectSkool(form);
      setResult(r);
      // Server action updates the DB, but this page was rendered as
      // "not connected". Refresh RSC payload so ConnectedCard + sidebar
      // update without a manual full reload.
      if (r.ok) router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="mt-5 grid gap-4">
      <Field
        label="auth_token"
        name="authToken"
        placeholder="eyJhbGciOi..."
        hint="The full JWT cookie from your logged-in Skool tab."
        error={result && !result.ok && result.field === "authToken" ? result.error : undefined}
      />
      <Field
        label="client_id"
        name="clientId"
        placeholder="d9d745b78db4444e..."
        hint="Found in the same Cookies panel as auth_token."
        error={result && !result.ok && result.field === "clientId" ? result.error : undefined}
      />
      <Field
        label="Group ID"
        name="groupId"
        placeholder="ca1d1972c55b437b..."
        hint="32-char hex: Skool → your community → Settings → Billing or Course settings (often shown there). Or copy from a /groups/… URL in DevTools → Network."
        error={result && !result.ok && result.field === "groupId" ? result.error : undefined}
      />

      {result && !result.ok && !result.field ? (
        <div className="rounded-lg border border-terracotta/40 bg-terracotta-soft px-4 py-3 text-sm text-terracotta-ink">
          {result.error}
        </div>
      ) : null}
      {result && result.ok ? (
        <div className="rounded-lg border border-forest/40 bg-forest-soft px-4 py-3 text-sm text-ink">
          Connected{result.communityName ? ` — ${result.communityName}` : ""}.
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-ink px-4 py-2 text-sm text-canvas hover:bg-ink/90 disabled:opacity-60"
        >
          {isPending ? "Verifying with Skool…" : "Connect Skool"}
        </button>
        <a
          href="/help/connect-skool"
          target="_blank"
          rel="noopener"
          className="text-sm text-ink underline-offset-4 hover:underline"
        >
          How do I find these?
        </a>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  hint,
  error,
}: {
  label: string;
  name: string;
  placeholder: string;
  hint: string;
  error?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        name={name}
        required
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-canvas px-3 py-2 font-mono text-sm outline-none ring-terracotta/30 focus:ring-2 ${
          error ? "border-terracotta" : "border-rule"
        }`}
      />
      <span className={`text-xs ${error ? "text-terracotta-ink" : "text-muted"}`}>
        {error ?? hint}
      </span>
    </label>
  );
}
