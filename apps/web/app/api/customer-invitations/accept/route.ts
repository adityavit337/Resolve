import { invitationRequest } from "../../../../lib/invitation-request";
import { acceptCustomerInvitation } from "../../../../lib/customer-intake";

export async function POST(request: Request) {
  return invitationRequest(request, async (body, userId) => ({ access: await acceptCustomerInvitation(body, userId) }));
}
