import { headers } from "next/headers";
import { getSession } from "../../../lib/auth";
import AcceptInvitation from "../../invitations/accept/accept-invitation";

export default async function CustomerInvitationPage() {
  const session = await getSession(await headers());
  return <main><h1>Accept customer invitation</h1><AcceptInvitation signedInEmail={session?.user.email ?? null} kind="customer" /></main>;
}
