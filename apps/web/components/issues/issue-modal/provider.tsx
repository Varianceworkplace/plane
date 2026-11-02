/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useSWRConfig } from "swr";
// plane imports
import { setToast } from "@plane/blocks/toast";
import type { ISearchIssueResponse, TIssue, TIssuePropertyValueErrors, TIssuePropertyValues } from "@plane/types";
// components
import { IssueModalContext } from "@/components/issues/issue-modal/context";
import type {
  TCreateUpdatePropertyValuesProps,
  TPropertyValuesValidationProps,
} from "@/components/issues/issue-modal/context";
import {
  readTaskDetailsForm,
  saveTaskDetailsForm,
  validateTaskDetailsForm,
} from "@/components/task-details/form-values";
import { projectMilestonesKey, workItemMilestoneKey } from "@/components/milestones/helpers";
import { TASK_DETAIL_FIELDS, taskDetailKey } from "@/components/task-details/helpers";
import { issueTimeEstimateKey, projectTimeEstimatesKey } from "@/components/worklogs/helpers";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user/user-user";

export type TIssueModalProviderProps = {
  templateId?: string;
  dataForPreload?: Partial<TIssue>;
  allowedProjectIds?: string[];
  children: React.ReactNode;
};

export const IssueModalProvider = observer(function IssueModalProvider(props: TIssueModalProviderProps) {
  const { children, allowedProjectIds } = props;
  // states
  const [selectedParentIssue, setSelectedParentIssue] = useState<ISearchIssueResponse | null>(null);
  // extra fields: the Project Task details of projects that turn them on
  const [issuePropertyValues, setIssuePropertyValues] = useState<TIssuePropertyValues>({});
  const [issuePropertyValueErrors, setIssuePropertyValueErrors] = useState<TIssuePropertyValueErrors>({});
  // store hooks
  const {
    projectsWithCreatePermissions,
    permission: { canCreateWorkItem },
  } = useUser();
  const { getProjectById } = useProject();
  const { mutate } = useSWRConfig();
  // derived values
  const projectIdsWithCreatePermissions = Object.keys(projectsWithCreatePermissions ?? {}).filter((id) =>
    canCreateWorkItem(id)
  );
  const taskDetailsProject = (projectId: string | null | undefined) => {
    const project = projectId ? getProjectById(projectId) : undefined;
    return project?.is_task_details_enabled ? project : undefined;
  };

  const handlePropertyValuesValidation = ({ projectId, watch, isDraft }: TPropertyValuesValidationProps) => {
    const project = taskDetailsProject(projectId);
    if (!project || isDraft) return true;
    const { errors, missing } = validateTaskDetailsForm(
      readTaskDetailsForm(issuePropertyValues),
      {
        assigneeIds: watch("assignee_ids"),
        assigneeGroupId: watch("assignee_group_id"),
        priority: watch("priority"),
        startDate: watch("start_date"),
        targetDate: watch("target_date"),
      },
      !!project.is_time_tracking_enabled
    );
    setIssuePropertyValueErrors(errors);
    if (!missing.length) return true;
    setToast({
      type: "error",
      title: missing.length === 1 ? "1 required field is empty" : `${missing.length} required fields are empty`,
      message: `Please fill in: ${missing.join(", ")}. They're marked in red under Project task details.`,
    });
    // bring the first one into view once the red outlines have rendered
    window.requestAnimationFrame(() =>
      document.querySelector("[data-task-detail-error]")?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
    return false;
  };

  const handleCreateUpdatePropertyValues = async ({
    issueId,
    projectId,
    workspaceSlug,
    isDraft,
  }: TCreateUpdatePropertyValuesProps) => {
    const project = taskDetailsProject(projectId);
    // drafts aren't work items yet; their details are filled in once they are
    if (!project || isDraft) return;
    try {
      await saveTaskDetailsForm(
        workspaceSlug,
        projectId,
        issueId,
        readTaskDetailsForm(issuePropertyValues),
        !!project.is_time_tracking_enabled,
        !!project.is_milestone_enabled
      );
      setIssuePropertyValues({});
      setIssuePropertyValueErrors({});
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({
        type: "error",
        title: "Task details not saved",
        message: `The project task was saved, but not its task details: ${Object.values(data)[0] ?? "please try again"}.`,
      });
    } finally {
      void mutate(taskDetailKey(issueId));
      void mutate(issueTimeEstimateKey(issueId));
      void mutate(projectTimeEstimatesKey(projectId));
      void mutate(workItemMilestoneKey(issueId));
      void mutate(projectMilestonesKey(projectId));
    }
  };

  return (
    <IssueModalContext.Provider
      // oxlint-disable-next-line react/jsx-no-constructed-context-values
      value={{
        allowedProjectIds: allowedProjectIds ?? projectIdsWithCreatePermissions,
        workItemTemplateId: null,
        setWorkItemTemplateId: () => {},
        isApplyingTemplate: false,
        setIsApplyingTemplate: () => {},
        selectedParentIssue,
        setSelectedParentIssue,
        issuePropertyValues,
        setIssuePropertyValues,
        issuePropertyValueErrors,
        setIssuePropertyValueErrors,
        getIssueTypeIdOnProjectChange: () => null,
        getActiveAdditionalPropertiesLength: ({ projectId }) =>
          taskDetailsProject(projectId) ? TASK_DETAIL_FIELDS.length : 0,
        handlePropertyValuesValidation,
        handleCreateUpdatePropertyValues,
        handleProjectEntitiesFetch: () => Promise.resolve(),
        handleTemplateChange: () => Promise.resolve(),
        handleConvert: () => Promise.resolve(),
        handleCreateSubWorkItem: () => Promise.resolve(),
      }}
    >
      {children}
    </IssueModalContext.Provider>
  );
});
