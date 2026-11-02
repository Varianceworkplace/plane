/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Navigate } from "react-router";
// plane imports
import { Tab, Tabs, TabsList } from "@makeplane/propel/components/tabs";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { PageHead } from "@/components/core/page-title";
import { WORKLOG_REPORT_TYPES, isWorklogReportType } from "@/components/worklog-reports/helpers";
import { MonthlyWorklogReport } from "@/components/worklog-reports/monthly-report";
import { WorklogReportRoot } from "@/components/worklog-reports/worklog-report-root";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function WorklogReportsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, reportType } = params;
  const router = useAppRouter();
  const { allowPermissions } = useUserPermissions();

  if (!isWorklogReportType(reportType)) return <Navigate to={`/${workspaceSlug}/reports/project-wise`} replace />;

  const report = WORKLOG_REPORT_TYPES.find((type) => type.key === reportType);
  const canView = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );

  return (
    <>
      <PageHead title={`${report?.label} report`} />
      {canView ? (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <Tabs
            variant="contained"
            value={reportType}
            onValueChange={(value) => router.push(`/${workspaceSlug}/reports/${value}`)}
          >
            <div className="flex w-full items-center border-b border-subtle bg-surface-1 px-6 py-2">
              <TabsList>
                {WORKLOG_REPORT_TYPES.map((type) => (
                  <Tab key={type.key} value={type.key} label={`${type.label} report`} />
                ))}
              </TabsList>
            </div>
          </Tabs>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* keyed so each report keeps its own filters */}
            {reportType === "monthly" ? (
              <MonthlyWorklogReport workspaceSlug={workspaceSlug} />
            ) : (
              <WorklogReportRoot key={reportType} workspaceSlug={workspaceSlug} reportType={reportType} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <EmptyStateCompact
            title="Reports aren't available to guests"
            description="Ask a workspace admin for member access to see time reports."
            assetKey="worklog"
            assetClassName="size-20"
            align="center"
          />
        </div>
      )}
    </>
  );
}

export default observer(WorklogReportsPage);
