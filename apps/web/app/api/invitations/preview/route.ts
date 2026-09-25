import { invitationRequest } from "../../../../lib/invitation-request";
import { previewInvitation } from "../../../../lib/invitations";

export async function POST(request: Request) {
  return invitationRequest(request, async (body) => ({ invitation: await previewInvitation(body.token) }));
}
