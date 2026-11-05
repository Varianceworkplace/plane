/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";
// assets
import VarianceLockupImage from "@/app/assets/logos/variance-lockup.png?url";
import VarianceLockupWhiteImage from "@/app/assets/logos/variance-lockup-white.png?url";
import VarianceMarkImage from "@/app/assets/logos/variance-mark.png?url";

type TVarianceLockupProps = {
  className?: string;
  // always use the white wordmark, for a lockup placed on a coloured background
  onColor?: boolean;
};

export function VarianceLockup({ className, onColor = false }: TVarianceLockupProps) {
  if (onColor) return <img src={VarianceLockupWhiteImage} alt="Variance" className={cn("w-auto", className)} />;

  return (
    <>
      <img src={VarianceLockupImage} alt="Variance" className={cn("w-auto dark:hidden", className)} />
      <img src={VarianceLockupWhiteImage} alt="Variance" className={cn("hidden w-auto dark:block", className)} />
    </>
  );
}

export function VarianceMark({ className }: { className?: string }) {
  return <img src={VarianceMarkImage} alt="Variance" className={cn("w-auto", className)} />;
}
