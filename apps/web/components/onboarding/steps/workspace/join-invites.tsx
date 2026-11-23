/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { ROLE } from "@plane/constants";
import { Button } from "@makeplane/propel/components/button";
import { Button as ButtonElement } from "@makeplane/propel/elements/button";
import type { IWorkspaceMemberInvitation } from "@plane/types";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Spinner } from "@plane/blocks/spinner";
import { setToast } from "@plane/blocks/toast";
import { truncateText } from "@plane/utils";
// constants
import { WorkspaceLogo } from "@/components/workspace/logo";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserSettings } from "@/hooks/store/user";
// services
import { WorkspaceService } from "@/services/workspace.service";
// local components
import { CommonOnboardingHeader } from "../common";

type Props = {
  invitations: IWorkspaceMemberInvitation[];
  handleNextStep: () => Promise<void>;
  handleCurrentViewChange: () => void;
};
const workspaceService = new WorkspaceService();

// observer: it reads the signed-in user and the instance settings from the stores
export const WorkspaceJoinInvitesStep = observer(function WorkspaceJoinInvitesStep(props: Props) {
  const { invitations, handleNextStep, handleCurrentViewChange } = props;
  // states
  const [isJoiningWorkspaces, setIsJoiningWorkspaces] = useState(false);
  // ticked to begin with: most people have just the one invitation, from their company
  const [invitationsRespond, setInvitationsRespond] = useState<string[]>(() =>
    props.invitations.map((invitation) => invitation.id)
  );
  // store hooks
  const { fetchWorkspaces } = useWorkspace();
  const { data: currentUser } = useUser();
  const { config } = useInstance();
  // when the server blocks new workspaces, the button would only lead to a "can't create" message
  const canCreateWorkspace = !config?.is_workspace_creation_disabled;
  // without a confirmed email (e.g. a password sign-up), joining goes through the invitation link and its token
  const needsInvitationLink = currentUser?.is_email_verified === false;
  const { fetchCurrentUserSettings } = useUserSettings();

  // handle invitation
  const handleInvitation = (workspace_invitation: IWorkspaceMemberInvitation, action: "accepted" | "withdraw") => {
    if (action === "accepted") {
      setInvitationsRespond((prevData) => [...prevData, workspace_invitation.id]);
    } else if (action === "withdraw") {
      setInvitationsRespond((prevData) => prevData.filter((item: string) => item !== workspace_invitation.id));
    }
  };

  // submit invitations
  const submitInvitations = async () => {
    const invitation = invitations?.find((item) => item.id === invitationsRespond[0]);

    if (invitationsRespond.length <= 0 && !invitation?.role) return;

    setIsJoiningWorkspaces(true);

    try {
      await workspaceService.joinWorkspaces({ invitations: invitationsRespond });
      await fetchWorkspaces();
      await fetchCurrentUserSettings();
      await handleNextStep();
    } catch (error: any) {
      console.error(error);
      setToast({
        type: "error",
        title: "Couldn't join",
        message: typeof error?.error === "string" ? error.error : "Something went wrong. Please try again.",
      });
      setIsJoiningWorkspaces(false);
    }
  };

  return invitations && invitations.length > 0 ? (
    <div className="flex flex-col gap-10">
      <CommonOnboardingHeader
        title={canCreateWorkspace ? "Join invites or create a workspace" : "Join your workspace"}
        description="All your work — unified."
      />
      <div className="flex flex-col gap-3">
        {invitations &&
          invitations.length > 0 &&
          invitations.map((invitation) => {
            const isSelected = invitationsRespond.includes(invitation.id);
            const invitedWorkspace = invitation.workspace;
            return (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- existing row; its checkbox is the keyboard control
              <div
                key={invitation.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border border-subtle px-3 py-2 hover:bg-surface-2`}
                onClick={() => handleInvitation(invitation, isSelected ? "withdraw" : "accepted")}
              >
                <div className="flex-shrink-0">
                  <WorkspaceLogo
                    logo={invitedWorkspace?.logo_url}
                    name={invitedWorkspace?.name}
                    classNames="size-8 flex-shrink-0 rounded-lg"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-13 font-medium">{truncateText(invitedWorkspace?.name, 30)}</div>
                  <p className="text-11 text-secondary">{ROLE[invitation.role]}</p>
                </div>
                <span className="pointer-events-none flex-shrink-0">
                  <Checkbox checked={isSelected} aria-label={invitedWorkspace?.name ?? "Select workspace invitation"} />
                </span>
              </div>
            );
          })}
      </div>
      <div className="flex flex-col gap-4">
        {needsInvitationLink && (
          <p className="text-body-xs-regular text-secondary">To join, open the invitation link we emailed you.</p>
        )}
        <ButtonElement
          variant="primary"
          size="lg"
          stretch="full"
          onClick={submitInvitations}
          disabled={isJoiningWorkspaces || !invitationsRespond.length || needsInvitationLink}
        >
          {isJoiningWorkspaces ? <Spinner height="20px" width="20px" /> : "Continue"}
        </ButtonElement>
        {canCreateWorkspace && (
          <Button
            variant="ghost"
            size="lg"
            stretch="full"
            label="Create new workspace"
            onClick={handleCurrentViewChange}
            disabled={isJoiningWorkspaces}
          />
        )}
      </div>
    </div>
  ) : (
    <div>No Invitations found</div>
  );
});
