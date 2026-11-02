/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import type { IProject } from "@plane/types";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { ProjectDetailFields } from "./fields";
import {
  EMPTY_PROJECT_DETAIL_FORM,
  projectDetailService,
  showProjectDetailErrors,
  toProjectDetailForm,
  toProjectDetailPayload,
  useProjectDetail,
  validateProjectDetailForm,
} from "./helpers";
import type { TProjectDetailFormErrors, TProjectDetailFormKey, TProjectDetailFormValues } from "./types";

type Props = {
  workspaceSlug: string;
  projectId: string;
  project: IProject;
  isAdmin: boolean;
};

const leadId = (project: IProject) => {
  const lead = project.project_lead;
  if (!lead) return null;
  return typeof lead === "string" ? lead : lead.id;
};

/** The Workplace project fields of a project, on its General settings page. Project admins edit them. */
export const ProjectDetailsSettingsSection = observer(function ProjectDetailsSettingsSection(props: Props) {
  const { workspaceSlug, projectId, project, isAdmin } = props;
  const { updateProject } = useProject();
  const { projectDetail, mutate } = useProjectDetail(workspaceSlug, projectId);
  // states
  const [values, setValues] = useState<TProjectDetailFormValues>(EMPTY_PROJECT_DETAIL_FORM);
  const [lead, setLead] = useState<string | null>(leadId(project));
  const [errors, setErrors] = useState<TProjectDetailFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  // start from what's saved, again whenever it changes
  useEffect(() => {
    if (projectDetail) setValues(toProjectDetailForm(projectDetail));
  }, [projectDetail]);
  useEffect(() => {
    setLead(leadId(project));
  }, [project]);

  const clearError = (key: TProjectDetailFormKey) =>
    setErrors((previous) => {
      if (!(key in previous)) return previous;
      const { [key]: _cleared, ...rest } = previous;
      return rest;
    });

  const handleSave = async () => {
    const found = validateProjectDetailForm(values, lead);
    setErrors(found);
    if (Object.keys(found).length) {
      showProjectDetailErrors(found);
      return;
    }
    setIsSaving(true);
    try {
      const saved = await projectDetailService.update(workspaceSlug, projectId, toProjectDetailPayload(values));
      await mutate(saved, { revalidate: false });
      if (lead !== leadId(project)) await updateProject(workspaceSlug, projectId, { project_lead: lead });
      setToast({ type: "success", title: "Saved", message: "Project details updated." });
    } catch (error) {
      // the server's own check (field -> message)
      const serverErrors =
        error && typeof error === "object" && !("error" in error) ? (error as TProjectDetailFormErrors) : {};
      if (Object.keys(serverErrors).length) {
        setErrors(serverErrors);
        showProjectDetailErrors(serverErrors);
      } else {
        setToast({
          type: "error",
          title: "Couldn't save",
          message:
            error && typeof error === "object" && "error" in error
              ? String(error.error)
              : "Something went wrong. Please try again.",
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mt-10 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-md-medium text-primary">Project details</h3>
        <p className="text-body-xs-regular text-tertiary">
          The project fields from Workplace: who it's assigned to, dates, type, status, customer and links.
        </p>
      </div>
      <ProjectDetailFields
        workspaceSlug={workspaceSlug}
        values={values}
        onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
        errors={errors}
        onClearError={clearError}
        lead={lead}
        onLeadChange={setLead}
        projectId={projectId}
        disabled={!isAdmin || !projectDetail}
      />
      {isAdmin && (
        <div>
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={isSaving ? "Saving" : "Save project details"}
            loading={isSaving}
            disabled={!projectDetail}
            onClick={() => void handleSave()}
          />
        </div>
      )}
    </section>
  );
});
