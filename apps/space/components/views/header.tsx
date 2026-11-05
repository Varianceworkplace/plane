/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { Link } from "react-router";
import { VarianceLockup } from "@/components/common/variance-logo";

export function AuthHeader() {
  return (
    <div className="sticky top-0 flex w-full flex-shrink-0 items-center justify-between gap-6">
      <Link to="/">
        <VarianceLockup className="h-8" />
      </Link>
    </div>
  );
}
