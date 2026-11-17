/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useLocation, useNavigate } from "react-router";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { ArrowNarrowLeftOutline, InboxOutline } from "@makeplane/propel/icons";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { Header } from "@plane/blocks/layout";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// local imports
import { NotificationSidebarHeaderOptions } from "./options";

type TNotificationSidebarHeader = {
  workspaceSlug: string;
};

export const NotificationSidebarHeader = observer(function NotificationSidebarHeader(
  props: TNotificationSidebarHeader
) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  // The app sidebar is hidden on this page, so this is the way out. React Router keys the first
  // page of a visit "default": with nothing to go back to, go to the workspace home instead.
  const handleBack = () => {
    if (location.key !== "default") void navigate(-1);
    else void navigate(`/${workspaceSlug}/`);
  };

  if (!workspaceSlug) return <></>;
  return (
    <Header className="my-auto bg-surface-1">
      <Header.LeftItem>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Icon icon={ArrowNarrowLeftOutline} />}
          aria-label={t("common.go_back")}
          onClick={handleBack}
        />
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("notification.label")}
                icon={<InboxOutline className="h-4 w-4 text-primary" />}
                disableTooltip
              />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
      <Header.RightItem>
        <NotificationSidebarHeaderOptions workspaceSlug={workspaceSlug} />
      </Header.RightItem>
    </Header>
  );
});
