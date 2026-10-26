"use client";

import { useActionState } from "react";
import { makeLoginLink } from "../actions";

// Ссылка для входа показывается один раз: её копируют и отправляют члену клуба
export function LoginLink({ slug, membershipId }: { slug: string; membershipId: string }) {
  const [link, action, pending] = useActionState(makeLoginLink, null);
  return (
    <form action={action} className="row">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="membershipId" value={membershipId} />
      {link ? (
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} size={40} />
      ) : (
        <button className="secondary" disabled={pending}>
          Ссылка для входа
        </button>
      )}
    </form>
  );
}
