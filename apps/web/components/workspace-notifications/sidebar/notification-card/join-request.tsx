/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Button } from "@makeplane/propel/components/button";
import { Row } from "@plane/blocks/layout";
import { setToast } from "@plane/blocks/toast";
import { cn, calculateTimeAgo, getFileURL } from "@plane/utils";
// components
import { accessControlService, toastError, useProjectJoinRequests } from "@/components/access-control/helpers";
import type { TProjectJoinRequest } from "@/components/access-control/types";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useNotification } from "@/hooks/store/notifications/use-notification";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// local imports
import { NotificationOption } from "./options";

type TProps = {
  workspaceSlug: string;
  notificationId: string;
};

/** Where a request stands, for the line under the title. */
const statusText = (request: TProjectJoinRequest | undefined, kind: string | undefined) => {
  if (kind === "approved") return "You can now create project tasks there and edit yours. Click to open the project.";
  if (kind === "rejected") return "You weren't added to the project.";
  if (!request) return "";
  if (request.status === "approved") return `Approved by ${request.decided_by?.name ?? "their PM"}`;
  if (request.status === "rejected") return `Rejected by ${request.decided_by?.name ?? "their PM"}`;
  return request.can_decide ? "Waiting for your approval" : "Waiting for a decision";
};

/** An Inbox notification about a request to join a project (role-based access): the PM approves or rejects it here,
 * and the person who asked hears the answer. */
export const JoinRequestNotificationItem = observer(function JoinRequestNotificationItem(props: TProps) {
  const { workspaceSlug, notificationId } = props;
  // states
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);
  const [deciding, setDeciding] = useState<"approved" | "rejected" | null>(null);
  // hooks
  const router = useAppRouter();
  const { currentSelectedNotificationId, setCurrentSelectedNotificationId } = useWorkspaceNotifications();
  const { asJson: notification, markNotificationAsRead } = useNotification(notificationId);
  const { joinRequests, mutate: refreshJoinRequests } = useProjectJoinRequests(workspaceSlug);
  const { fetchProjects } = useProject();
  const { fetchUserProjectPermissions, fetchWorkspaceAccess } = useUserPermissions();
  // derived values
  const request = joinRequests?.requests.find((item) => item.id === notification.entity_identifier);
  // requested (to the PM), approved / rejected (to the person who asked)
  const kind = notification.sender?.split(":")[1];
  const triggeredBy = notification.triggered_by_details;

  const markRead = async () => {
    if (notification.read_at !== null) return;
    try {
      await markNotificationAsRead(workspaceSlug);
    } catch (error) {
      console.error(error);
    }
  };

  const handleClick = async () => {
    if (isSnoozeStateModalOpen || customSnoozeModal) return;
    setCurrentSelectedNotificationId(notificationId);
    await markRead();
    if (kind === "approved" && notification.project) {
      // they've just been added as a member: load the project, their role in it and what they may now do there
      // (create work items, edit their own) before opening it
      await Promise.all([
        fetchProjects(workspaceSlug),
        fetchUserProjectPermissions(workspaceSlug),
        fetchWorkspaceAccess(workspaceSlug),
      ]).catch((error: unknown) => console.error(error));
      router.push(`/${workspaceSlug}/projects/${notification.project}/issues`);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!request) return;
    setDeciding(decision);
    try {
      await accessControlService.decideJoinRequest(workspaceSlug, request.id, decision);
      setToast({
        type: "success",
        title: decision === "approved" ? "Request approved" : "Request rejected",
        message:
          decision === "approved"
            ? `${request.member.name} was added to ${request.project_name}.`
            : `${request.member.name} was not added to ${request.project_name}.`,
      });
      await markRead();
    } catch (error) {
      toastError("Not saved", error);
    } finally {
      setDeciding(null);
      void refreshJoinRequests();
    }
  };

  if (!workspaceSlug || !notification?.id) return null;

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all",
        {
          "bg-layer-1/30": currentSelectedNotificationId === notification.id,
          "bg-accent-primary/5": notification.read_at === null,
        }
      )}
      onClick={() => void handleClick()}
    >
      {notification.read_at === null && (
        <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}

      <div className="relative flex w-full gap-2">
        <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
          {triggeredBy && (
            <Avatar
              alt={triggeredBy.display_name || triggeredBy.first_name}
              fallback={(triggeredBy.display_name || triggeredBy.first_name)?.[0]?.toUpperCase()}
              src={getFileURL(triggeredBy.avatar_url)}
              size="xl"
            />
          )}
        </div>

        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium break-all whitespace-normal text-primary">
              {notification.title}
            </div>
            <NotificationOption
              workspaceSlug={workspaceSlug}
              notificationId={notification.id}
              isSnoozeStateModalOpen={isSnoozeStateModalOpen}
              setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
              customSnoozeModal={customSnoozeModal}
              setCustomSnoozeModal={setCustomSnoozeModal}
            />
          </div>

          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">
              {statusText(request, kind)}
            </div>
            <p className="mt-auto flex-shrink-0 text-tertiary">
              {notification.created_at && calculateTimeAgo(notification.created_at)}
            </p>
          </div>

          {kind === "requested" && request?.can_decide && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                stretch="auto"
                label="Approve"
                loading={deciding === "approved"}
                disabled={!!deciding}
                onClick={(e) => {
                  e.stopPropagation();
                  void decide("approved");
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label="Reject"
                loading={deciding === "rejected"}
                disabled={!!deciding}
                onClick={(e) => {
                  e.stopPropagation();
                  void decide("rejected");
                }}
              />
            </div>
          )}
        </div>
      </div>
    </Row>
  );
});
