/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";
import {
  CyclesOutline,
  EstimateOutline,
  IntakeOutline,
  LabelsOutline,
  LockOutline,
  MilestoneOutline,
  PropertiesOutline,
  MembersOutline,
  ModuleOutline,
  PagesOutline,
  StateOutline,
  TimeTrackingOutline,
  TriggerOutline,
  ViewsOutline,
} from "@makeplane/propel/icons";
// plane imports
import type { ISvgIcons } from "@plane/blocks/icons";
import type { TProjectSettingsTabs } from "@plane/types";
// components
import { SettingIcon } from "@/components/icons/attachment";

export const PROJECT_SETTINGS_ICONS: Record<TProjectSettingsTabs, LucideIcon | React.FC<ISvgIcons>> = {
  general: SettingIcon,
  members: MembersOutline,
  access: LockOutline,
  features_cycles: CyclesOutline,
  features_modules: ModuleOutline,
  features_views: ViewsOutline,
  features_pages: PagesOutline,
  features_intake: IntakeOutline,
  features_time_tracking: TimeTrackingOutline,
  features_milestones: MilestoneOutline,
  features_task_details: PropertiesOutline,
  states: StateOutline,
  labels: LabelsOutline,
  estimates: EstimateOutline,
  automations: TriggerOutline,
};
