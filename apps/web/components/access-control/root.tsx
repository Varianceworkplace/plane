/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useSWRConfig } from "swr";
// plane imports
import { Tab, Tabs, TabsList, TabsPanel } from "@makeplane/propel/components/tabs";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
// local imports
import { AccessCheckTab } from "./check-access-tab";
import { accessKeys, useAccessControl } from "./helpers";
import { AccessOverviewTab } from "./overview-tab";
import { AccessPeopleTab } from "./people-tab";
import { AccessRolesTab } from "./roles-tab";
import { AccessTeamsTab } from "./teams-tab";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "roles", label: "Roles" },
  { value: "teams", label: "Teams" },
  { value: "people", label: "People" },
  { value: "check", label: "Check access" },
];

/** Workspace settings › Access control: workspace admins and people with Role management (HR). */
export const AccessControlRoot = observer(function AccessControlRoot(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { overview, error, mutate } = useAccessControl(workspaceSlug);
  const [tab, setTab] = useState("overview");
  const { mutate: revalidate } = useSWRConfig();

  const openTab = (value: string) => {
    // roles, teams or people may have changed: the overview's preview follows them
    if (value === "overview") void revalidate(accessKeys.preview(workspaceSlug));
    setTab(value);
  };

  if (error) return <NotAuthorizedView section="settings" className="h-auto" />;
  if (!overview) return <div className="h-40 animate-pulse rounded-lg bg-layer-1" />;

  return (
    <Tabs variant="underline" value={tab} onValueChange={(value) => openTab(String(value))}>
      <TabsList>
        {TABS.map((item) => (
          <Tab key={item.value} value={item.value} label={item.label} />
        ))}
      </TabsList>
      <div className="pt-5">
        <TabsPanel value="overview">
          <AccessOverviewTab
            workspaceSlug={workspaceSlug}
            overview={overview}
            onChanged={() => void mutate()}
            onOpenTab={setTab}
          />
        </TabsPanel>
        <TabsPanel value="roles">
          <AccessRolesTab workspaceSlug={workspaceSlug} overview={overview} />
        </TabsPanel>
        <TabsPanel value="teams">
          <AccessTeamsTab workspaceSlug={workspaceSlug} overview={overview} />
        </TabsPanel>
        <TabsPanel value="people">
          <AccessPeopleTab workspaceSlug={workspaceSlug} />
        </TabsPanel>
        <TabsPanel value="check">
          <AccessCheckTab workspaceSlug={workspaceSlug} overview={overview} />
        </TabsPanel>
      </div>
    </Tabs>
  );
});
