/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { AttachOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// plane imports
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// local imports
import { IssueAttachmentActionButton } from "./attachments";
import { IssueDetailWidgetButton } from "./widget-button";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
  hideWidgets?: TWorkItemWidgets[];
};

export function IssueDetailWidgetActionButtons(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType, hideWidgets } = props;
  // translation
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Variance's project tasks take no sub-tasks, relations or links: only attachments are added here (the
          relations Workplace's tasks came with still show below) */}
      {!hideWidgets?.includes("attachments") && (
        <IssueAttachmentActionButton
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          customButton={
            <IssueDetailWidgetButton
              title={t("common.attach")}
              icon={<AttachOutline className="h-3.5 w-3.5 flex-shrink-0" />}
              disabled={disabled}
            />
          }
          disabled={disabled}
          issueServiceType={issueServiceType}
        />
      )}
    </div>
  );
}
