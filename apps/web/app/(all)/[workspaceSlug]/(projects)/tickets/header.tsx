/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { CopyOutline, EditOutline, MessageSupportOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { TicketService } from "@/services/ticket.service";

const ticketService = new TicketService();

export function TicketsHeader() {
  const { workspaceSlug, ticketId } = useParams();
  const pathname = usePathname();
  const router = useAppRouter();
  const slug = workspaceSlug?.toString() ?? "";
  const id = ticketId?.toString();
  const isNew = /\/tickets\/new\/?$/.test(pathname ?? "");
  const isEdit = /\/edit\/?$/.test(pathname ?? "");
  // Shares the SWR cache entry used by the detail and edit pages.
  const { data: ticket } = useSWR(id ? ["TICKET", slug, id] : null, () => ticketService.retrieve(slug, id as string));

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                href={`/${slug}/tickets`}
                label="Tickets"
                icon={<MessageSupportOutline className="size-4 text-secondary" />}
              />
            }
          />
          {id && ticket && (
            <Breadcrumbs.Item
              component={<BreadcrumbLink href={`/${slug}/tickets/${id}`} label={ticket.ticket_number} />}
            />
          )}
          {isEdit && <Breadcrumbs.Item component={<BreadcrumbLink label="Edit" />} />}
          {isNew && <Breadcrumbs.Item component={<BreadcrumbLink label="New ticket" />} />}
        </Breadcrumbs>
      </Header.LeftItem>
      <Header.RightItem>
        {!id && !isNew && (
          <Link href={`/${slug}/tickets/new`}>
            <Button stretch="auto" variant="primary" size="md" label="Add Ticket" />
          </Link>
        )}
        {id && ticket && !isEdit && (
          <>
            {ticket.can_edit && (
              <Link href={`/${slug}/tickets/${id}/edit`}>
                <Button stretch="auto" variant="secondary" size="md" label="Edit" icon={<Icon icon={EditOutline} />} />
              </Link>
            )}
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    variant="secondary"
                    size="md"
                    icon={<Icon icon={MoreHorizontalOutline} />}
                    aria-label="More actions"
                  />
                }
              />
              <MenuContent side="bottom" align="end">
                {ticket.can_edit ? (
                  <MenuItem
                    label="Duplicate"
                    icon={<Icon icon={CopyOutline} />}
                    onClick={() => router.push(`/${slug}/tickets/new?duplicate=${id}`)}
                  />
                ) : (
                  <MenuItem label="No actions available" disabled />
                )}
              </MenuContent>
            </Menu>
          </>
        )}
      </Header.RightItem>
    </Header>
  );
}
