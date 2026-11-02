/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { TicketService } from "@/services/ticket.service";

const ticketService = new TicketService();

export const useTicketMeta = (workspaceSlug: string) => {
  const { data, error } = useSWR(workspaceSlug ? ["TICKET_META", workspaceSlug] : null, () =>
    ticketService.meta(workspaceSlug)
  );
  return { meta: data, error };
};
