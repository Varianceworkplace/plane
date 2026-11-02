/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
// plane imports
import { TimeTrackingOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { useProjectCrumbProps } from "@/components/breadcrumbs/use-project-crumb-props";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { ProjectWorklogsRoot } from "@/components/worklogs/project/project-worklogs-root";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

function ProjectWorklogsPage() {
  const { workspaceSlug: routeSlug, projectId: routeProjectId } = useParams();
  const workspaceSlug = routeSlug?.toString() ?? "";
  const projectId = routeProjectId?.toString() ?? "";
  const projectCrumb = useProjectCrumbProps(workspaceSlug, projectId);
  const { getProjectById, loader } = useProject();
  const { allowPermissions, workspaceUserInfo } = useUserPermissions();
  const project = getProjectById(projectId);
  // project admins and members log time; guests don't
  const canView = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const isProjectAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const body = () => {
    if (!project) return null;
    if (workspaceUserInfo && !canView) return <NotAuthorizedView section="general" isProjectView className="h-auto" />;
    if (!project.is_time_tracking_enabled)
      return (
        <div className="flex flex-col items-center gap-2 px-page-x py-16 text-center">
          <TimeTrackingOutline className="size-8 text-tertiary" />
          <p className="text-body-sm-medium text-primary">Time tracking is turned off for this project</p>
          {isProjectAdmin ? (
            <Link
              href={`/${workspaceSlug}/settings/projects/${projectId}/features/time-tracking/`}
              className="text-body-xs-regular text-accent-primary hover:underline"
            >
              Turn it on in project settings
            </Link>
          ) : (
            <p className="text-body-xs-regular text-tertiary">Ask a project admin to turn it on.</p>
          )}
        </div>
      );
    return <ProjectWorklogsRoot workspaceSlug={workspaceSlug} projectId={projectId} />;
  };

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
                      label="Worklogs"
                      href={`/${workspaceSlug}/projects/${projectId}/worklogs/`}
                      icon={<TimeTrackingOutline className="h-4 w-4 text-tertiary" />}
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
        <PageHead title={project?.name ? `${project.name} - Worklogs` : undefined} />
        {body()}
      </ContentWrapper>
    </>
  );
}

export default observer(ProjectWorklogsPage);
