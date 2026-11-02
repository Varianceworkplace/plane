/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// plane imports
import { DashboardsOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { WORKLOG_REPORT_TYPES } from "@/components/worklog-reports/helpers";

export function WorklogReportsHeader() {
  const { workspaceSlug, reportType } = useParams();
  const report = WORKLOG_REPORT_TYPES.find((type) => type.key === reportType?.toString());

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                href={`/${workspaceSlug?.toString()}/reports`}
                label="Reports"
                icon={<DashboardsOutline className="size-4 text-secondary" />}
              />
            }
          />
          {report && <Breadcrumbs.Item component={<BreadcrumbLink label={`${report.label} report`} />} />}
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
}
