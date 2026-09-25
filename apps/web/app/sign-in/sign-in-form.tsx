"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";

export default function SignInForm({ next = "/" }: { next?: "/" | "/customer" }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    try {
      const result = await authClient.signIn.email({
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      });
      if (result.error) {
        setMessage(result.error.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "Could not sign in. Check your email and password and try again.");
        return;
      }
      form.reset();
      // A fresh document avoids keeping the previous user's UI in the router cache.
      window.location.replace(next);
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={signIn}>
      <p>
        <label htmlFor="email">Email</label><br />
        <input id="email" name="email" type="email" autoComplete="username" required disabled={pending} />
      </p>
      <p>
        <label htmlFor="password">Password</label><br />
        <input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} />
      </p>
      <p role="status">{message}</p>
      <button disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
