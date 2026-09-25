import { invitationRequest } from "../../../../lib/invitation-request";
import { previewCustomerInvitation } from "../../../../lib/customer-intake";

export async function POST(request: Request) {
  return invitationRequest(request, async (body) => ({ invitation: await previewCustomerInvitation(body.token) }));
}
