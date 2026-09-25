import { headers } from "next/headers";
import { getSession } from "../../../lib/auth";
import AcceptInvitation from "./accept-invitation";

export default async function InvitationPage() {
  const session = await getSession(await headers());
  return <main><h1>Accept workspace invitation</h1><AcceptInvitation signedInEmail={session?.user.email ?? null} /></main>;
}
