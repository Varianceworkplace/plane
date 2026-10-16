/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { TicketDetail } from "@/components/tickets/detail/ticket-detail";
import { useTicketMeta } from "@/components/tickets/use-ticket-meta";

export default function TicketDetailPage() {
  const { workspaceSlug, ticketId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const { meta } = useTicketMeta(slug);

  return (
    <>
      <PageHead title="Ticket" />
      <div className="h-full w-full overflow-hidden">
        {meta && ticketId ? (
          <TicketDetail workspaceSlug={slug} ticketId={ticketId.toString()} meta={meta} />
        ) : (
          <p className="px-page-x py-6 text-body-xs-regular text-placeholder">Loading…</p>
        )}
      </div>
    </>
  );
}
