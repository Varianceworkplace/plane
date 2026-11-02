/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { ChevronDownOutline, ChevronRightOutline, PropertiesOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// local imports
import { TaskDetailFieldInput } from "./field-input";
import {
  EMPTY_TASK_DETAIL,
  TASK_DETAIL_FIELDS,
  isTaskDetailValueSet,
  taskDetailService,
  useTaskDetail,
  useTaskDetailOptions,
} from "./helpers";
import type { TTaskDetail } from "./types";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

/** "Task details" block of the work item sidebar / peek view: every Project Task field, editable in place. */
export const WorkItemTaskDetails = observer(function WorkItemTaskDetails(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false } = props;
  const [isOpen, setIsOpen] = useState(true);
  const options = useTaskDetailOptions(workspaceSlug);
  const { taskDetail, mutate } = useTaskDetail(workspaceSlug, projectId, issueId);
  const values = taskDetail ?? EMPTY_TASK_DETAIL;
  const missing = TASK_DETAIL_FIELDS.filter(
    (field) => field.required && !isTaskDetailValueSet(values[field.key])
  ).length;

  const save = async (patch: Partial<TTaskDetail>) => {
    const previous = taskDetail;
    // show the change right away, roll back if the server refuses it
    await mutate({ ...values, ...patch }, { revalidate: false });
    try {
      await mutate(await taskDetailService.update(workspaceSlug, projectId, issueId, patch), { revalidate: false });
    } catch (err) {
      await mutate(previous, { revalidate: false });
      const data = (err ?? {}) as Record<string, string>;
      setToast({
        type: "error",
        title: "Task detail not saved",
        message: Object.values(data)[0] ?? "Something went wrong. Please try again.",
      });
    }
  };

  const Chevron = isOpen ? ChevronDownOutline : ChevronRightOutline;

  return (
    <div className="flex flex-col gap-2 border-t border-subtle pt-3">
      <button
        type="button"
        className="flex items-center gap-1.5 text-body-xs-medium text-secondary hover:text-primary"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Chevron className="size-3.5" />
        <PropertiesOutline className="size-4" />
        <span>Task details</span>
        {missing > 0 && (
          <span className="font-normal text-warning-primary">
            · {missing} required {missing === 1 ? "field" : "fields"} empty
          </span>
        )}
      </button>
      {isOpen &&
        TASK_DETAIL_FIELDS.map((field) => (
          <div key={field.key} className="flex items-start gap-2">
            <div className="flex min-h-7.5 w-30 shrink-0 items-center text-body-xs-regular text-tertiary">
              <span>
                {field.label}
                {field.required && <span className="text-danger-primary"> *</span>}
              </span>
            </div>
            <div className={cn("flex min-w-0 grow items-center", field.kind === "text" && "py-0.5")}>
              <div className="w-full min-w-0">
                <TaskDetailFieldInput
                  field={field}
                  value={values[field.key]}
                  options={options}
                  onChange={(value) => void save({ [field.key]: value })}
                  mode="inline"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        ))}
    </div>
  );
});
