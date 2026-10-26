"use client";

import { useActionState } from "react";

// Кнопка, после нажатия которой показывается ответ: ссылка (её копируют и отправляют
// члену клуба, показывается один раз) или итог рассылки в Max
export function ResultButton({
  action,
  label,
  fields,
}: {
  action: (prev: string | null, f: FormData) => Promise<string | null>;
  label: string;
  fields: Record<string, string>;
}) {
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="row">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {result?.startsWith("http") ? (
        <input readOnly value={result} onFocus={(e) => e.currentTarget.select()} size={40} />
      ) : (
        <>
          <button className="secondary" disabled={pending}>
            {label}
          </button>
          {result && <span className="muted">{result}</span>}
        </>
      )}
    </form>
  );
}
