/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
import { TicketList } from "@/components/tickets/list/ticket-list";
import { useTicketMeta } from "@/components/tickets/use-ticket-meta";

export default function TicketsListPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const { meta } = useTicketMeta(slug);

  return (
    <>
      <PageHead title="Tickets" />
      <div className="relative h-full w-full overflow-hidden">
        {meta ? (
          <TicketList workspaceSlug={slug} meta={meta} />
        ) : (
          <p className="px-page-x py-6 text-body-xs-regular text-placeholder">Loading…</p>
        )}
      </div>
    </>
  );
}
