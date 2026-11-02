/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
// hooks
import { useUserPermissions } from "@/hooks/store/user";

/** A workspace page of one module: "not authorized" when role-based access doesn't let the person view it. */
export const RbacModuleGuard = observer(function RbacModuleGuard(props: { module: string; children: ReactNode }) {
  const { module, children } = props;
  const { canAccess } = useUserPermissions();
  if (!canAccess(module, "view")) return <NotAuthorizedView section="general" className="h-auto" />;
  return <>{children}</>;
});
