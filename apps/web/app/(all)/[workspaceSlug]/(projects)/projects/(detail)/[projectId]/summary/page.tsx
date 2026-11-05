/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { DashboardsOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { useProjectCrumbProps } from "@/components/breadcrumbs/use-project-crumb-props";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { ProjectSummaryRoot } from "@/components/project-summary/root";
// hooks
import { useProject } from "@/hooks/store/use-project";

function ProjectSummaryPage() {
  const { workspaceSlug: routeSlug, projectId: routeProjectId } = useParams();
  const workspaceSlug = routeSlug?.toString() ?? "";
  const projectId = routeProjectId?.toString() ?? "";
  const projectCrumb = useProjectCrumbProps(workspaceSlug, projectId);
  const { getProjectById, loader } = useProject();
  const project = getProjectById(projectId);

  return (
    <>
      <AppHeader
        header={
          <Header>
            <Header.LeftItem>
              <Breadcrumbs isLoading={loader === "init-loader"}>
                <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug} projectId={projectId} {...projectCrumb} />
                <Breadcrumbs.Item
                  component={
                    <BreadcrumbLink
                      label="Summary"
                      href={`/${workspaceSlug}/projects/${projectId}/summary/`}
                      icon={<DashboardsOutline className="h-4 w-4 text-tertiary" />}
                      isLast
                    />
                  }
                  isLast
                />
              </Breadcrumbs>
            </Header.LeftItem>
          </Header>
        }
      />
      <ContentWrapper>
        <PageHead title={project?.name ? `${project.name} - Summary` : undefined} />
        {project && <ProjectSummaryRoot workspaceSlug={workspaceSlug} projectId={projectId} />}
      </ContentWrapper>
    </>
  );
}

export default observer(ProjectSummaryPage);
