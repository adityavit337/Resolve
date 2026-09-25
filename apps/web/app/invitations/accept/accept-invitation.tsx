"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../../../lib/auth-client";
import SignOutButton from "../../sign-out-button";

type Invitation = { email: string; role: string; workspaceName: string; existingAccount: boolean };

export default function AcceptInvitation({ signedInEmail, kind = "staff" }: { signedInEmail: string | null; kind?: "staff" | "customer" }) {
  const customer = kind === "customer";
  const path = customer ? "/customer-invitations/accept" : "/invitations/accept";
  const apiPath = customer ? "/api/customer-invitations" : "/api/invitations";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("Loading invitation...");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const value = window.location.hash.slice(1);
    setToken(value);
    async function preview() {
      try {
        const response = await fetch(`${apiPath}/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load invitation.");
        if (!controller.signal.aborted) { setInvitation(data.invitation); setMessage(""); }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load invitation.");
      }
    }
    void preview();
    return () => controller.abort();
  }, [apiPath]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    setPending(true);
    setMessage("");
    try {
      if (!signedInEmail && invitation.existingAccount) {
        const result = await authClient.signIn.email({ email: invitation.email, password });
        if (result.error) throw new Error("Could not sign in. Check your password, or wait briefly if you have made several attempts.");
      }
      const response = await fetch(`${apiPath}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...(!invitation.existingAccount && !signedInEmail ? { name: data.get("name"), password } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not accept invitation.");
      window.history.replaceState(null, "", path);
      setToken("");
      if ((customer ? result.access : result.membership).signInRequired) {
        setDone(true);
        setMessage(customer ? "Account created. Sign in to submit a ticket." : "Account created and invitation accepted. Sign in with your new password to open your workspace.");
      } else window.location.replace(customer ? "/customer" : "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach the server.");
    } finally { setPending(false); }
  }

  const wrongAccount = invitation && signedInEmail && signedInEmail.toLowerCase() !== invitation.email;
  return <>
    <p role="status">{message}</p>
    {done ? <a href={customer ? "/sign-in?next=%2Fcustomer" : "/sign-in"}>Sign in</a> : invitation && <>
      <p>{customer ? `Submit tickets to ${invitation.workspaceName} as a customer, using ${invitation.email}.` : `Join ${invitation.workspaceName} as ${invitation.role}, using ${invitation.email}.`}</p>
      {wrongAccount ? <>
        <p>You are signed in as {signedInEmail}. Sign out, then reopen the original invitation link.</p>
        <SignOutButton />
      </> : <form onSubmit={accept}>
        {!signedInEmail && <>
          {!invitation.existingAccount && <p><label htmlFor="invite-name">Your name </label><input id="invite-name" name="name" required maxLength={100} autoComplete="name" disabled={pending} /></p>}
          <p><label htmlFor="invite-password">{invitation.existingAccount ? "Your password" : "Choose a password"} </label>
            <input id="invite-password" name="password" type="password" required minLength={invitation.existingAccount ? undefined : 12} maxLength={128} autoComplete={invitation.existingAccount ? "current-password" : "new-password"} disabled={pending} /></p>
        </>}
        <button disabled={pending}>{pending ? "Accepting..." : "Accept invitation"}</button>
      </form>}
    </>}
  </>;
}
