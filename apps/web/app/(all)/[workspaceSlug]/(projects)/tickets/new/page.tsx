/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
// components
import { PageHead } from "@/components/core/page-title";
import { TicketForm } from "@/components/tickets/form/ticket-form";
import { useTicketMeta } from "@/components/tickets/use-ticket-meta";
// services
import { TicketService } from "@/services/ticket.service";

const ticketService = new TicketService();

export default function TicketCreatePage() {
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const slug = workspaceSlug?.toString() ?? "";
  const duplicateId = searchParams.get("duplicate");
  const { meta } = useTicketMeta(slug);
  const { data: source, isLoading } = useSWR(duplicateId ? ["TICKET", slug, duplicateId] : null, () =>
    ticketService.retrieve(slug, duplicateId as string)
  );

  return (
    <>
      <PageHead title="Creating New Ticket" />
      <div className="h-full w-full overflow-y-auto">
        {meta && (!duplicateId || !isLoading) ? (
          <TicketForm key={source?.id ?? "new"} workspaceSlug={slug} meta={meta} duplicateFrom={source} />
        ) : (
          <p className="px-page-x py-6 text-body-xs-regular text-placeholder">Loading…</p>
        )}
      </div>
    </>
  );
}
