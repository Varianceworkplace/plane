/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { FieldErrors } from "react-hook-form";
import { FormProvider, useForm } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import { setToast } from "@plane/blocks/toast";
import { PropertiesOutline } from "@makeplane/propel/icons";
import { EFileAssetType } from "@plane/types";
// components
import ProjectCommonAttributes from "@/components/project/create/common-attributes";
import ProjectCreateHeader from "@/components/project/create/header";
import ProjectCreateButtons from "@/components/project/create/project-create-buttons";
import { ProjectDetailFields } from "@/components/project-details/fields";
import {
  EMPTY_PROJECT_DETAIL_FORM,
  showProjectDetailErrors,
  toProjectDetailPayload,
  validateProjectDetailForm,
} from "@/components/project-details/helpers";
import type {
  TProjectDetailFormErrors,
  TProjectDetailFormKey,
  TProjectDetailFormValues,
} from "@/components/project-details/types";
// hooks
import { getCoverImageType, uploadCoverImage } from "@/helpers/cover-image.helper";
import { useProject } from "@/hooks/store/use-project";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web types
import type { TProject } from "@plane/types";
import { ProjectAttributes } from "./attributes";
import { getProjectFormValues } from "./utils";

export type TCreateProjectFormProps = {
  setToFavorite?: boolean;
  workspaceSlug: string;
  onClose: () => void;
  handleNextStep: (projectId: string) => void;
  data?: Partial<TProject>;
  templateId?: string;
  updateCoverImageStatus: (projectId: string, coverImage: string) => Promise<void>;
};

export const CreateProjectForm = observer(function CreateProjectForm(props: TCreateProjectFormProps) {
  const { setToFavorite, workspaceSlug, data, onClose, handleNextStep, updateCoverImageStatus } = props;
  // store
  const { t } = useTranslation();
  const { addProjectToFavorites, createProject, updateProject } = useProject();
  // states
  const [shouldAutoSyncIdentifier, setShouldAutoSyncIdentifier] = useState(true);
  // the Workplace project fields; "Assigned To" is the form's project_lead
  const [details, setDetails] = useState<TProjectDetailFormValues>(EMPTY_PROJECT_DETAIL_FORM);
  const [detailErrors, setDetailErrors] = useState<TProjectDetailFormErrors>({});
  // form info
  const methods = useForm<TProject>({
    defaultValues: { ...getProjectFormValues(), ...data },
    reValidateMode: "onChange",
  });
  const { handleSubmit, reset, setValue, watch } = methods;
  const projectLead = watch("project_lead");
  const { isMobile } = usePlatformOS();
  const handleAddToFavorites = (projectId: string) => {
    if (!workspaceSlug) return;

    addProjectToFavorites(workspaceSlug.toString(), projectId).catch(() => {
      setToast({
        type: "error",
        title: t("toast.error"),
        message: t("failed_to_remove_project_from_favorites"),
      });
    });
  };

  const checkDetails = (lead: unknown) => {
    const errors = validateProjectDetailForm(details, typeof lead === "string" ? lead : null);
    setDetailErrors(errors);
    return errors;
  };

  // the name / identifier fields show their own errors; still flag the project fields in the same pass
  const onInvalid = (_errors: FieldErrors<TProject>) => {
    showProjectDetailErrors(checkDetails(methods.getValues("project_lead")));
  };

  const onSubmit = async (formData: Partial<TProject>) => {
    const errors = checkDetails(formData.project_lead);
    if (Object.keys(errors).length) {
      showProjectDetailErrors(errors);
      return;
    }
    // Upper case identifier
    formData.identifier = formData.identifier?.toUpperCase();
    const coverImage = formData.cover_image_url;
    let uploadedAssetUrl: string | null = null;

    if (coverImage) {
      const imageType = getCoverImageType(coverImage);

      if (imageType === "local_static") {
        try {
          uploadedAssetUrl = await uploadCoverImage(coverImage, {
            workspaceSlug: workspaceSlug.toString(),
            entityIdentifier: "",
            entityType: EFileAssetType.PROJECT_COVER,
            isUserAsset: false,
          });
        } catch (error) {
          console.error("Error uploading cover image:", error);
          setToast({
            type: "error",
            title: t("toast.error"),
            message: error instanceof Error ? error.message : "Failed to upload cover image",
          });
          return Promise.reject(error);
        }
      } else {
        formData.cover_image = coverImage;
        formData.cover_image_asset = null;
      }
    }

    // project_details isn't a project field: the server saves it alongside the new project
    const payload = { ...formData, project_details: toProjectDetailPayload(details) } as Partial<TProject>;
    return createProject(workspaceSlug.toString(), payload)
      .then(async (res) => {
        if (uploadedAssetUrl) {
          await updateCoverImageStatus(res.id, uploadedAssetUrl);
          await updateProject(workspaceSlug.toString(), res.id, { cover_image_url: uploadedAssetUrl });
        } else if (coverImage && coverImage.startsWith("http")) {
          await updateCoverImageStatus(res.id, coverImage);
          await updateProject(workspaceSlug.toString(), res.id, { cover_image_url: coverImage });
        }
        setToast({
          type: "success",
          title: t("success"),
          message: t("project_created_successfully"),
        });

        if (setToFavorite) {
          handleAddToFavorites(res.id);
        }
        return handleNextStep(res.id);
      })
      .catch((err) => {
        try {
          // Handle the new error format where codes are nested in arrays under field names
          const errorData = err?.data ?? {};

          // the server's own check of the project fields (field -> message)
          if (errorData.project_details && typeof errorData.project_details === "object") {
            const serverErrors = Object.fromEntries(
              Object.entries(errorData.project_details as Record<string, string | string[]>).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(" ") : String(value),
              ])
            ) as TProjectDetailFormErrors;
            setDetailErrors(serverErrors);
            showProjectDetailErrors(serverErrors);
            return;
          }

          const nameError = errorData.name?.includes("PROJECT_NAME_ALREADY_EXIST");
          const identifierError = errorData?.identifier?.includes("PROJECT_IDENTIFIER_ALREADY_EXIST");
          const nameSpecialCharError = errorData?.name?.includes("PROJECT_NAME_CANNOT_CONTAIN_SPECIAL_CHARACTERS");

          if (nameError || identifierError || nameSpecialCharError) {
            if (nameError) {
              setToast({
                type: "error",
                title: t("toast.error"),
                message: t("project_name_already_taken"),
              });
            }

            if (identifierError) {
              setToast({
                type: "error",
                title: t("toast.error"),
                message: t("project_identifier_already_taken"),
              });
            }

            if (nameSpecialCharError) {
              setToast({
                type: "error",
                title: t("toast.error"),
                message: t("project_name_cannot_contain_special_characters"),
              });
            }
          } else {
            setToast({
              type: "error",
              title: t("toast.error"),
              message: t("something_went_wrong"),
            });
          }
        } catch (error) {
          // Fallback error handling if the error processing fails
          console.error("Error processing API error:", error);
          setToast({
            type: "error",
            title: t("toast.error"),
            message: t("something_went_wrong"),
          });
        }
      });
  };

  const clearDetailError = (key: TProjectDetailFormKey) =>
    setDetailErrors((previous) => {
      if (!(key in previous)) return previous;
      const { [key]: _cleared, ...rest } = previous;
      return rest;
    });

  const handleClose = () => {
    onClose();
    setShouldAutoSyncIdentifier(true);
    setTimeout(() => {
      reset();
      setDetails(EMPTY_PROJECT_DETAIL_FORM);
      setDetailErrors({});
    }, 300);
  };

  return (
    <FormProvider {...methods}>
      <ProjectCreateHeader handleClose={handleClose} isMobile={isMobile} />

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="px-3">
        <div className="mt-9 space-y-6 pb-5">
          <ProjectCommonAttributes
            setValue={setValue}
            isMobile={isMobile}
            shouldAutoSyncIdentifier={shouldAutoSyncIdentifier}
            setShouldAutoSyncIdentifier={setShouldAutoSyncIdentifier}
          />
          <ProjectAttributes isMobile={isMobile} />
          <section className="flex flex-col gap-3 border-t border-subtle pt-4">
            <div className="flex items-center gap-1.5">
              <PropertiesOutline className="size-4 text-tertiary" />
              <h4 className="text-body-sm-medium text-primary">Project details</h4>
              <span className="text-caption-md-regular text-placeholder">
                · fields marked <span className="text-danger-primary">*</span> are required
              </span>
            </div>
            <ProjectDetailFields
              workspaceSlug={workspaceSlug.toString()}
              values={details}
              onChange={(patch) => setDetails((previous) => ({ ...previous, ...patch }))}
              errors={detailErrors}
              onClearError={clearDetailError}
              lead={typeof projectLead === "string" ? projectLead : null}
              onLeadChange={(lead) => setValue("project_lead", lead)}
            />
          </section>
        </div>
        <ProjectCreateButtons handleClose={handleClose} />
      </form>
    </FormProvider>
  );
});
