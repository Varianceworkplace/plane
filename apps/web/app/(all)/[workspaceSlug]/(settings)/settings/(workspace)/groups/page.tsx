/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { WORKSPACE_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { PageHead } from "@/components/core/page-title";
import { useCanViewGroups } from "@/components/member-groups/helpers";
import { GroupsSettings } from "@/components/member-groups/groups-settings";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { WORKSPACE_SETTINGS_ICONS } from "@/components/settings/workspace/sidebar/item-icon";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// local imports
import type { Route } from "./+types/page";

const GroupsSettingsHeader = observer(function GroupsSettingsHeader() {
  const { t } = useTranslation();
  const Icon = WORKSPACE_SETTINGS_ICONS.groups;

  return (
    <SettingsPageHeader
      leftItem={
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t(WORKSPACE_SETTINGS.groups.i18n_label)}
                icon={<Icon className="size-4 text-tertiary" />}
              />
            }
          />
        </Breadcrumbs>
      }
    />
  );
});

/** Workspace settings › Groups (plane.db.models.member_group on the server). */
function GroupsSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { currentWorkspace } = useWorkspace();
  const canView = useCanViewGroups(workspaceSlug);
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - Groups` : undefined;

  return (
    <SettingsContentWrapper header={<GroupsSettingsHeader />}>
      <PageHead title={pageTitle} />
      <div className="flex w-full flex-col gap-y-6">
        <SettingsHeading
          title="Groups"
          description="Groups of team members that project tasks can be assigned to. Admins and HR manage every group; Project Managers manage the groups they created."
        />
        {canView ? (
          <GroupsSettings workspaceSlug={workspaceSlug} />
        ) : (
          <p className="text-body-sm-regular text-tertiary">You don't have access to Groups.</p>
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(GroupsSettingsPage);
