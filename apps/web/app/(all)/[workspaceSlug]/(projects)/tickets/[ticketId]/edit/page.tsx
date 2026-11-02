/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
// components
import { PageHead } from "@/components/core/page-title";
import { TicketForm } from "@/components/tickets/form/ticket-form";
import { useTicketMeta } from "@/components/tickets/use-ticket-meta";
// services
import { TicketService } from "@/services/ticket.service";

const ticketService = new TicketService();

export default function TicketEditPage() {
  const { workspaceSlug, ticketId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const id = ticketId?.toString() ?? "";
  const { meta } = useTicketMeta(slug);
  const { data: ticket, error } = useSWR(id ? ["TICKET", slug, id] : null, () => ticketService.retrieve(slug, id));

  let content: React.ReactNode = <p className="px-page-x py-6 text-body-xs-regular text-placeholder">Loading…</p>;
  if (error || (ticket && !ticket.can_edit))
    content = (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-body-sm-medium text-secondary">Only the assigned user can edit this ticket.</p>
        <Link href={`/${slug}/tickets/${id}`} className="text-body-xs-medium text-accent-primary hover:underline">
          Back to ticket
        </Link>
      </div>
    );
  else if (ticket && meta) content = <TicketForm key={ticket.id} workspaceSlug={slug} meta={meta} ticket={ticket} />;

  return (
    <>
      <PageHead title="Edit Ticket" />
      <div className="h-full w-full overflow-y-auto">{content}</div>
    </>
  );
}
