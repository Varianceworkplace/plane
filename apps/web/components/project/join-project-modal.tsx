/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// types
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import type { IProject } from "@plane/types";
// ui
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
// components
import { accessControlService, toastError, useProjectJoinRequests } from "@/components/access-control/helpers";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";

// type
type TJoinProjectModalProps = {
  isOpen: boolean;
  workspaceSlug: string;
  project: IProject;
  handleClose: () => void;
};

export const JoinProjectModal = observer(function JoinProjectModal(props: TJoinProjectModalProps) {
  const { handleClose, isOpen, project, workspaceSlug } = props;
  // states
  const [isJoiningLoading, setIsJoiningLoading] = useState(false);
  // store hooks
  const { joinProject, canOnProject } = useUserPermissions();
  const { data: currentUser } = useUser();
  // router
  const router = useAppRouter();
  // role-based access: people who can't manage the project ask their PM, who approves or rejects it
  const needsApproval = !canOnProject("edit", project.id, workspaceSlug);
  const { joinRequests, mutate: refreshJoinRequests } = useProjectJoinRequests(needsApproval ? workspaceSlug : "");
  const pmNames = (joinRequests?.pms ?? []).map((pm) => pm.name).join(", ");
  const hasNoPm = !!joinRequests && joinRequests.pms.length === 0;
  const isRequested = !!joinRequests?.requests.some(
    (request) =>
      request.project_id === project.id && request.status === "pending" && request.member.id === currentUser?.id
  );

  const handleJoin = async () => {
    setIsJoiningLoading(true);

    await joinProject(workspaceSlug, project.id)
      .then(() => {
        router.push(`/${workspaceSlug}/projects/${project.id}/issues`);
        handleClose();
        return;
      })
      .catch(() => {
        console.error("Error joining project");
      })
      .finally(() => {
        setIsJoiningLoading(false);
      });
  };

  const handleRequest = async () => {
    setIsJoiningLoading(true);
    try {
      await accessControlService.requestToJoin(workspaceSlug, project.id);
      setToast({
        type: "success",
        title: "Request sent",
        message: `${pmNames || "Your PM"} will review your request to join ${project.name}.`,
      });
      void refreshJoinRequests();
      handleClose();
    } catch (error) {
      toastError("Request not sent", error);
    } finally {
      setIsJoiningLoading(false);
    }
  };

  const renderBody = () => {
    const projectName = <span className="font-semibold break-words">{project?.name}</span>;
    if (!needsApproval)
      return (
        <p>
          Are you sure you want to join the project {projectName}? Please click the &apos;Join Project&apos; button
          below to continue.
        </p>
      );
    if (isRequested)
      return (
        <p>
          Your request to join {projectName} is waiting for approval from {pmNames || "your PM"}. You&apos;ll be added
          once it&apos;s approved.
        </p>
      );
    if (hasNoPm)
      return (
        <p>
          You need your PM&apos;s approval to join {projectName}, but you don&apos;t have a PM yet. Ask HR to add you to
          a team.
        </p>
      );
    return (
      <p>
        Your PM, {pmNames || "…"}, will be notified and can approve or reject your request to join {projectName}. Once
        it&apos;s approved you&apos;re added as a member and can create project tasks there.
      </p>
    );
  };

  const canSendRequest = needsApproval && !!joinRequests && !isRequested && !hasNoPm;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent size="sm">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{needsApproval ? "Request to join?" : "Join Project?"}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>{renderBody()}</DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label={needsApproval && !canSendRequest ? "Close" : "Cancel"}
            onClick={handleClose}
          />
          {!needsApproval && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={isJoiningLoading ? "Joining..." : "Join Project"}
              onClick={handleJoin}
              loading={isJoiningLoading}
            />
          )}
          {canSendRequest && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={isJoiningLoading ? "Sending..." : "Send request"}
              onClick={() => void handleRequest()}
              loading={isJoiningLoading}
            />
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});
