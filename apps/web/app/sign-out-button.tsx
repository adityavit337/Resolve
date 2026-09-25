"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signOut() {
    setPending(true);
    setMessage("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      window.location.replace("/sign-in");
    } catch {
      setMessage("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button onClick={signOut} disabled={pending}>{pending ? "Signing out..." : "Sign out"}</button>
      <p role="status">{message}</p>
    </div>
  );
}
