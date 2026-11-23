/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { BoxesOutline, CloseOutline, TickOutline, UserOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { EmptySpace, EmptySpaceItem } from "@/components/ui/empty-space";
// constants
import { WORKSPACE_INVITATION } from "@plane/constants";
// helpers
import { EPageTypes } from "@/helpers/authentication.helper";
// hooks
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// wrappers
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { WorkspaceService } from "@/services/workspace.service";
// services

// service initialization
const workspaceService = new WorkspaceService();

const WORKSPACE_DESCRIPTION =
  "Your workspace is where you'll create projects, collaborate on your project tasks, and organize different streams of work in your Variance account.";

const errorMessage = (err: unknown) => {
  const message = (err as { error?: unknown } | undefined)?.error;
  return typeof message === "string" && message ? message : "Something went wrong. Please try again.";
};

function WorkspaceInvitationPage() {
  // router
  const router = useAppRouter();
  const pathname = usePathname();
  // query params
  const searchParams = useSearchParams();
  const invitation_id = searchParams.get("invitation_id");
  const slug = searchParams.get("slug");
  const token = searchParams.get("token");
  // store hooks
  const { data: currentUser, signOut } = useUser();

  const { data: invitationDetail, error } = useSWR(
    invitation_id && slug && WORKSPACE_INVITATION(invitation_id.toString()),
    invitation_id && slug
      ? () => workspaceService.getWorkspaceInvitation(slug.toString(), invitation_id.toString())
      : null
  );

  const invitedEmail = invitationDetail?.email ?? "";
  // (signed out, the store still holds an empty user, so check for an id)
  const signedIn = !!currentUser?.id;
  const signedInAsInvitee = signedIn && (currentUser?.email ?? "").toLowerCase() === invitedEmail.toLowerCase();

  // Signed out: sign in (or create the account) first, then come back to this same link to accept it.
  const goToSignIn = () => {
    const invitationLink = `${pathname}?${searchParams.toString()}`;
    router.push(`/?next_path=${encodeURIComponent(invitationLink)}`);
  };

  const respond = (accepted: boolean) => {
    if (!invitationDetail || !token) {
      setToast({
        type: "error",
        title: "This invitation link is incomplete",
        message: "Open the link from your invitation email again.",
      });
      return;
    }
    workspaceService
      .joinWorkspace(invitationDetail.workspace.slug, invitationDetail.id, { accepted, token })
      .then(() => {
        router.push(accepted ? `/${invitationDetail.workspace.slug}` : "/");
        return undefined;
      })
      .catch((err: unknown) => {
        setToast({
          type: "error",
          title: accepted ? "Couldn't accept the invitation" : "Couldn't ignore the invitation",
          message: errorMessage(err),
        });
      });
  };

  const renderContent = () => {
    if (!invitation_id || !slug)
      return (
        <EmptySpace
          title="This invitation link is incomplete"
          description="Open the link from your invitation email again, or ask your admin to send a new invitation."
        >
          <EmptySpaceItem Icon={BoxesOutline} title="Continue to home" href="/" />
        </EmptySpace>
      );

    if (!invitationDetail && !error)
      return (
        <div className="flex h-full w-full items-center justify-center">
          <LogoSpinner />
        </div>
      );

    if (error || !invitationDetail || invitationDetail.responded_at)
      return invitationDetail?.accepted ? (
        <EmptySpace
          title={`You are already a member of ${invitationDetail.workspace.name}`}
          description={WORKSPACE_DESCRIPTION}
        >
          <EmptySpaceItem Icon={BoxesOutline} title="Continue to home" href="/" />
        </EmptySpace>
      ) : (
        <EmptySpace
          title="This invitation link is not active anymore."
          description={WORKSPACE_DESCRIPTION}
          link={{ text: "Or start from an empty project", href: "/" }}
        >
          {!signedIn ? (
            <EmptySpaceItem Icon={UserOutline} title="Sign in to continue" href="/" />
          ) : (
            <EmptySpaceItem Icon={BoxesOutline} title="Continue to home" href="/" />
          )}
        </EmptySpace>
      );

    if (invitationDetail.is_expired)
      return (
        <EmptySpace
          title="This invitation has expired"
          description={`Invitations stay open for a week. Ask your admin to resend the invitation to ${invitedEmail}.`}
        >
          <EmptySpaceItem Icon={BoxesOutline} title="Continue to home" href="/" />
        </EmptySpace>
      );

    if (!signedIn)
      return (
        <EmptySpace
          title={`You have been invited to ${invitationDetail.workspace.name}`}
          description={`Sign in, or create your Variance account, with ${invitedEmail} to accept the invitation.`}
        >
          <EmptySpaceItem Icon={TickOutline} title="Sign in to accept" action={goToSignIn} />
          <EmptySpaceItem Icon={CloseOutline} title="Not now" href="/" />
        </EmptySpace>
      );

    if (!signedInAsInvitee)
      return (
        <EmptySpace
          title={`This invitation is for ${invitedEmail}`}
          description={`You're signed in as ${currentUser?.email ?? "another account"}. Sign out, then open the invitation link again and sign in as ${invitedEmail}.`}
        >
          <EmptySpaceItem Icon={UserOutline} title="Sign out" action={() => void signOut()} />
          <EmptySpaceItem Icon={BoxesOutline} title="Continue to home" href="/" />
        </EmptySpace>
      );

    return (
      <EmptySpace
        title={`You have been invited to ${invitationDetail.workspace.name}`}
        description={WORKSPACE_DESCRIPTION}
      >
        <EmptySpaceItem Icon={TickOutline} title="Accept" action={() => respond(true)} />
        <EmptySpaceItem Icon={CloseOutline} title="Ignore" action={() => respond(false)} />
      </EmptySpace>
    );
  };

  return (
    <AuthenticationWrapper pageType={EPageTypes.PUBLIC}>
      <div className="flex h-full w-full flex-col items-center justify-center px-3">{renderContent()}</div>
    </AuthenticationWrapper>
  );
}

export default observer(WorkspaceInvitationPage);
