/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";

/** A workspace member's avatar and name. */
export const Person = observer(function Person(props: { userId: string; suffix?: string; className?: string }) {
  const { userId, suffix, className } = props;
  const { getUserDetails } = useMember();
  const user = getUserDetails(userId);
  const name = user ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.display_name : "Unknown";
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar size="sm" src={getFileURL(user?.avatar_url ?? "")} alt={name} />
      <span className="truncate text-body-xs-medium text-primary">{name}</span>
      {suffix && <span className="shrink-0 text-caption-md-regular text-tertiary">{suffix}</span>}
    </span>
  );
});

/** "Name" for lists that only need text (sorting, labels). */
export const usePersonName = () => {
  const { getUserDetails } = useMember();
  return (userId: string) => {
    const user = getUserDetails(userId);
    return user ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.display_name : "Unknown";
  };
};
