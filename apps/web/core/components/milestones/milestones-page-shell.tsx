/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
import { MilestoneOutline } from "@makeplane/propel/icons";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { useProjectCrumbProps } from "@/components/breadcrumbs/use-project-crumb-props";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";

type Props = {
  workspaceSlug: string;
  projectId: string;
  /** extra breadcrumb after "Milestones" */
  crumb?: ReactNode;
  actions?: ReactNode;
  title: string;
  children: (canEdit: boolean) => ReactNode;
};

/** Header + permission / feature checks shared by the milestone pages. */
export const MilestonesPageShell = observer(function MilestonesPageShell(props: Props) {
  const { workspaceSlug, projectId, crumb, actions, title, children } = props;
  const projectCrumb = useProjectCrumbProps(workspaceSlug, projectId);
  const { getProjectById, loader } = useProject();
  const { allowPermissions, workspaceUserInfo } = useUserPermissions();
  const project = getProjectById(projectId);
  // project admins and members use milestones; guests don't see them
  const canEdit = allowPermissions(
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
    if (workspaceUserInfo && !canEdit) return <NotAuthorizedView section="general" isProjectView className="h-auto" />;
    if (!project.is_milestone_enabled)
      return (
        <div className="flex flex-col items-center gap-2 px-page-x py-16 text-center">
          <MilestoneOutline className="size-8 text-tertiary" />
          <p className="text-body-sm-medium text-primary">Milestones are turned off for this project</p>
          {isProjectAdmin ? (
            <Link
              href={`/${workspaceSlug}/settings/projects/${projectId}/features/milestones/`}
              className="text-body-xs-regular text-accent-primary hover:underline"
            >
              Turn them on in project settings
            </Link>
          ) : (
            <p className="text-body-xs-regular text-tertiary">Ask a project admin to turn them on.</p>
          )}
        </div>
      );
    return children(canEdit);
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
                      label="Milestones"
                      href={`/${workspaceSlug}/projects/${projectId}/milestones/`}
                      icon={<MilestoneOutline className="h-4 w-4 text-tertiary" />}
                      isLast={!crumb}
                    />
                  }
                  isLast={!crumb}
                />
                {crumb}
              </Breadcrumbs>
            </Header.LeftItem>
            {project?.is_milestone_enabled && canEdit && actions && <Header.RightItem>{actions}</Header.RightItem>}
          </Header>
        }
      />
      <ContentWrapper>
        <PageHead title={project?.name ? `${project.name} - ${title}` : undefined} />
        {body()}
      </ContentWrapper>
    </>
  );
});
