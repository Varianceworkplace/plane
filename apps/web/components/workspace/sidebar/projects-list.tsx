/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState, useRef, useEffect } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Collapsible } from "@makeplane/propel/components/collapsible";
import { AddOutline, HideOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Icon } from "@makeplane/propel/components/icon";
import { setToast } from "@plane/blocks/toast";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { Loader } from "@plane/blocks/skeleton";
import { copyUrlToClipboard, cn, orderJoinedProjects } from "@plane/utils";
// components
import { CreateProjectModal } from "@/components/project/create-project-modal";
import { CountChip } from "@/components/common/count-chip";
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useProjectFilter } from "@/hooks/store/use-project-filter";
import { useUserPermissions } from "@/hooks/store/user";
import { useProjectNavigationPreferences } from "@/hooks/use-navigation-preferences";
import { useRenderInBatches } from "@/hooks/use-render-in-batches";
// plane web imports
import type { TProject } from "@plane/types";
// local imports
import { SidebarProjectsListItem } from "./projects-list-item";
import { useSidebarWorkingProjects } from "./use-working-projects";

/** sidebar project entries drawn at a time (see useRenderInBatches) */
const SIDEBAR_PROJECTS_BATCH = 40;

export const SidebarProjectsList = observer(function SidebarProjectsList() {
  // states
  const [isAllProjectsListOpen, setIsAllProjectsListOpen] = useState(true);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false); // scroll animation state
  // refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  // store hooks
  const { t } = useTranslation();
  const { toggleCreateProjectModal } = useCommandPalette();
  const { allowPermissions, canAccess } = useUserPermissions();
  const { preferences: projectPreferences } = useProjectNavigationPreferences();
  const { isExtendedProjectSidebarOpened, toggleExtendedProjectSidebar } = useAppTheme();

  // the person's own list (Show in List / Hide from List); hidden projects stay on All Projects
  const {
    loader,
    getPartialProjectById,
    sidebarProjectIds: joinedProjects,
    sidebarWorkingProjectIds,
    joinedProjectIds,
    updateProjectView,
  } = useProject();
  const hiddenCount = joinedProjectIds.length - joinedProjects.length;
  const { updateDisplayFilters } = useProjectFilter();
  // router params
  const { workspaceSlug, projectId: openProjectId } = useParams();
  const pathname = usePathname();
  // the projects they're working on come first (latest timer activity) and stay there: not draggable
  useSidebarWorkingProjects(workspaceSlug?.toString() ?? "");
  const workingProjects = new Set(sidebarWorkingProjectIds);

  // auth
  const isAuthorizedUser =
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE) &&
    canAccess("projects", "create");

  // Compute limited projects for main sidebar
  const displayedProjects = projectPreferences.showLimitedProjects
    ? joinedProjects.slice(0, projectPreferences.limitedProjectsCount)
    : joinedProjects;

  // Most people's list holds 650–1,300 projects, and each entry follows the route (all of them re-rendered on every
  // click): they're drawn 40 at a time as the list scrolls, the open project's entry always among them
  const {
    shownItems: renderedProjects,
    hasMore: moreToRender,
    endRef,
  } = useRenderInBatches(
    displayedProjects,
    SIDEBAR_PROJECTS_BATCH,
    openProjectId ? displayedProjects.indexOf(openProjectId.toString()) : -1
  );

  // Check if there are more projects to show
  const hasMoreProjects =
    projectPreferences.showLimitedProjects && joinedProjects.length > projectPreferences.limitedProjectsCount;

  const handleCopyText = (projectId: string) => {
    copyUrlToClipboard(`${workspaceSlug}/projects/${projectId}/summary`).then(() => {
      setToast({
        type: "success",
        title: t("link_copied"),
        message: t("project_link_copied_to_clipboard"),
      });
      return undefined;
    });
  };

  const handleOnProjectDrop = (
    sourceId: string | undefined,
    destinationId: string | undefined,
    shouldDropAtEnd: boolean
  ) => {
    if (!sourceId || !destinationId || !workspaceSlug) return;
    if (sourceId === destinationId) return;

    // the person's own order: the projects below the ones they're working on
    const orderedProjects = joinedProjects.filter((projectId) => !workingProjects.has(projectId));
    const joinedProjectsList: TProject[] = [];
    orderedProjects.map((projectId) => {
      const projectDetails = getPartialProjectById(projectId);
      if (projectDetails) joinedProjectsList.push(projectDetails);
    });

    const sourceIndex = orderedProjects.indexOf(sourceId);
    const destinationIndex = shouldDropAtEnd ? orderedProjects.length : orderedProjects.indexOf(destinationId);
    if (sourceIndex < 0 || destinationIndex < 0) return;

    if (joinedProjectsList.length <= 0) return;

    const updatedSortOrder = orderJoinedProjects(sourceIndex, destinationIndex, sourceId, joinedProjectsList);
    if (updatedSortOrder != undefined)
      updateProjectView(workspaceSlug.toString(), sourceId, { sort_order: updatedSortOrder }).catch(() => {
        setToast({
          type: "error",
          title: t("error"),
          message: t("something_went_wrong"),
        });
      });
  };

  /**
   * Implementing scroll animation styles based on the scroll length of the container
   */
  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current) {
        const scrollTop = containerRef.current.scrollTop;
        setIsScrolled(scrollTop > 0);
      }
    };
    const currentContainerRef = containerRef.current;
    if (currentContainerRef) {
      currentContainerRef.addEventListener("scroll", handleScroll);
    }
    return () => {
      if (currentContainerRef) {
        currentContainerRef.removeEventListener("scroll", handleScroll);
      }
    };
  }, [containerRef]);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
        canScroll: ({ source }) => source?.data?.dragInstanceId === "PROJECTS",
        getAllowedAxis: () => "vertical",
      })
    );
  }, [containerRef]);

  const toggleListDisclosure = (isOpen: boolean) => {
    setIsAllProjectsListOpen(isOpen);
    localStorage.setItem("isAllProjectsListOpen", isOpen.toString());
  };
  useEffect(() => {
    if (pathname.includes("projects")) {
      setIsAllProjectsListOpen(true);
      localStorage.setItem("isAllProjectsListOpen", "true");
    }
  }, [pathname]);
  return (
    <>
      {workspaceSlug && (
        <CreateProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          setToFavorite={false}
          workspaceSlug={workspaceSlug.toString()}
        />
      )}
      <div
        ref={containerRef}
        className={cn({
          "border-t border-strong": isScrolled,
        })}
      >
        <>
          <Collapsible
            placement="sidebar"
            // the group marker lives on the root: CollapsibleHeader takes no className
            render={<div className="group/projects-section" />}
            open={isAllProjectsListOpen}
            onOpenChange={toggleListDisclosure}
            trigger={
              <span className="flex items-center gap-1.5">
                <span className="text-13 font-semibold whitespace-nowrap text-placeholder">{t("projects")}</span>
                {/* the projects in their list, also those under "More" */}
                {loader !== "init-loader" && joinedProjects.length > 0 && (
                  <CountChip count={joinedProjects.length} className="py-0" />
                )}
              </span>
            }
            trailing={
              isAuthorizedUser ? (
                <span className="hidden text-placeholder group-focus-within/projects-section:inline-flex group-hover/projects-section:inline-flex">
                  <Tooltip label={t("create_project")}>
                    <IconButton
                      variant="ghost"
                      size="xs"
                      icon={<Icon icon={AddOutline} />}
                      onClick={() => {
                        setIsProjectModalOpen(true);
                      }}
                      aria-label={t("aria_labels.projects_sidebar.create_new_project")}
                    />
                  </Tooltip>
                </span>
              ) : null
            }
          >
            <div className="flex flex-col gap-0.5">
              {loader === "init-loader" && (
                <Loader className="w-full space-y-1.5">
                  {Array.from({ length: 4 }).map((_, index) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <Loader.Item key={index} height="28px" />
                  ))}
                </Loader>
              )}
              {renderedProjects.map((projectId, index) => (
                <SidebarProjectsListItem
                  key={projectId}
                  projectId={projectId}
                  handleCopyText={() => handleCopyText(projectId)}
                  projectListType={"JOINED"}
                  disableDrag={workingProjects.has(projectId)}
                  disableDrop={workingProjects.has(projectId)}
                  isLastChild={index === displayedProjects.length - 1}
                  handleOnProjectDrop={handleOnProjectDrop}
                />
              ))}
              {moreToRender && <div ref={endRef} aria-hidden className="h-px w-full" />}
              {hasMoreProjects && (
                <SidebarNavItem>
                  <button
                    type="button"
                    onClick={() => toggleExtendedProjectSidebar()}
                    className="flex flex-grow items-center gap-1.5 text-13 font-medium text-tertiary"
                    id="extended-project-sidebar-toggle"
                    aria-label={t(
                      isExtendedProjectSidebarOpened
                        ? "aria_labels.app_sidebar.close_extended_sidebar"
                        : "aria_labels.app_sidebar.open_extended_sidebar"
                    )}
                  >
                    <MoreHorizontalOutline className="size-4 flex-shrink-0" />
                    <span>{isExtendedProjectSidebarOpened ? "Hide" : "More"}</span>
                  </button>
                </SidebarNavItem>
              )}
              {loader !== "init-loader" && hiddenCount > 0 && (
                <SidebarNavItem>
                  <Link
                    href={`/${workspaceSlug}/projects/`}
                    // All Projects opens on the hidden ones, ready for Show in List
                    onClick={() =>
                      updateDisplayFilters(workspaceSlug.toString(), { in_my_list: false, hidden_from_my_list: true })
                    }
                    className="flex flex-grow items-center gap-1.5 text-13 font-medium text-tertiary"
                  >
                    <HideOutline className="size-4 flex-shrink-0" />
                    <span className="truncate">
                      {joinedProjects.length === 0
                        ? `All ${hiddenCount} hidden · Show some`
                        : `${hiddenCount} hidden · All projects`}
                    </span>
                  </Link>
                </SidebarNavItem>
              )}
            </div>
          </Collapsible>
        </>

        {isAuthorizedUser && joinedProjectIds.length === 0 && (
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-13 leading-5 font-medium text-secondary hover:bg-surface-2"
            onClick={() => {
              toggleCreateProjectModal(true);
            }}
          >
            {t("add_project")}
          </button>
        )}
      </div>
    </>
  );
});
