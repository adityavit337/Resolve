import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import SignInForm from "./sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next === "/customer" ? "/customer" : "/";
  if (await getSession(await headers())) redirect(next);

  return (
    <main>
      <h1>Sign in to Resolve</h1>
      <SignInForm next={next} />
    </main>
  );
}
