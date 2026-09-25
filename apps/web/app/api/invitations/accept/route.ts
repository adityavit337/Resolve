import { invitationRequest } from "../../../../lib/invitation-request";
import { acceptInvitation } from "../../../../lib/invitations";

export async function POST(request: Request) {
  return invitationRequest(request, async (body, userId) => ({ membership: await acceptInvitation(body, userId) }));
}
