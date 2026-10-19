/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
// plane imports
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Icon } from "@makeplane/propel/components/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { EditOutline, MoreHorizontalOutline, TimeTrackingOutline, DeleteOutline } from "@makeplane/propel/icons";
import { calculateTimeAgo, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { formatWorklogDuration, getWorklogUserName } from "./helpers";
import type { TWorklog } from "./types";

type Props = {
  workspaceSlug: string;
  worklog: TWorklog;
  ends: "top" | "bottom" | undefined;
  canManage: boolean;
  onEdit: (worklog: TWorklog) => void;
  onDelete: (worklog: TWorklog) => void;
};

/** One "X logged 1h 30m" row in the work item activity feed. Matches IssueActivityBlockComponent. */
export function WorklogActivityItem(props: Props) {
  const { workspaceSlug, worklog, ends, canManage, onEdit, onDelete } = props;
  const { isMobile } = usePlatformOS();

  return (
    <div
      className={`relative flex items-start gap-3 text-caption-sm-regular ${
        ends === "top" ? `pb-2` : ends === "bottom" ? `pt-2` : `py-2`
      }`}
    >
      <div className="absolute top-0 bottom-0 left-[13px] w-px bg-layer-3" aria-hidden />
      <div className="z-[4] flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-layer-2 text-secondary shadow-raised-100">
        <TimeTrackingOutline className="h-3.5 w-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <div className="truncate text-secondary">
            <Link
              href={`/${workspaceSlug}/profile/${worklog.logged_by.id}`}
              className="font-medium text-primary hover:underline"
            >
              {getWorklogUserName(worklog.logged_by)}
            </Link>
            <span> logged </span>
            <span className="font-medium text-primary">{formatWorklogDuration(worklog.duration)}</span>
            {worklog.started_at && worklog.ended_at && (
              <span className="text-tertiary">
                {" "}
                ({renderFormattedTime(worklog.started_at, "12-hour")} –{" "}
                {renderFormattedTime(worklog.ended_at, "12-hour")}, {renderFormattedDate(worklog.started_at)})
              </span>
            )}
            <span>. </span>
            <Tooltip
              label={`${renderFormattedDate(worklog.created_at)}, ${renderFormattedTime(worklog.created_at)}`}
              disabled={isMobile}
            >
              <span className="whitespace-nowrap text-tertiary">{calculateTimeAgo(worklog.created_at)}</span>
            </Tooltip>
          </div>
          {canManage && (
            <Menu>
              <MenuTrigger
                render={
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={MoreHorizontalOutline} />}
                    aria-label="Worklog options"
                  />
                }
              />
              <MenuContent side="bottom" align="end">
                <MenuItem label="Edit" icon={<Icon icon={EditOutline} />} onClick={() => onEdit(worklog)} />
                <MenuItem label="Delete" icon={<Icon icon={DeleteOutline} />} onClick={() => onDelete(worklog)} />
              </MenuContent>
            </Menu>
          )}
        </div>
        {worklog.description && (
          <div className="rounded-md border border-subtle bg-surface-1 px-2.5 py-1.5 text-body-xs-regular break-words whitespace-pre-wrap text-secondary">
            {worklog.description}
          </div>
        )}
      </div>
    </div>
  );
}
