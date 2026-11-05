/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { VarianceMark } from "./variance-logo";

export function LogoSpinner() {
  return (
    <div className="flex items-center justify-center">
      <VarianceMark className="h-6 animate-pulse sm:h-11" />
    </div>
  );
}
