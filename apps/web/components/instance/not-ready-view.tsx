/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { GOD_MODE_URL } from "@plane/constants";
// assets
import VarianceMarkImage from "@/app/assets/logos/variance-mark.png?url";
import { VarianceLockup } from "@/components/common/variance-logo";
import DefaultLayout from "@/layouts/default-layout";
import { Button } from "@makeplane/propel/components/button";

export function InstanceNotReady() {
  return (
    <DefaultLayout>
      <div className="relative z-10 flex h-screen w-screen overflow-hidden">
        {/* Background decorations */}
        <img
          src={VarianceMarkImage}
          className="pointer-events-none absolute -top-24 -left-32 h-56 w-96 object-contain opacity-15"
          alt=""
          aria-hidden="true"
        />
        <img
          src={VarianceMarkImage}
          className="pointer-events-none absolute -right-20 -bottom-16 h-56 w-96 object-contain opacity-15"
          alt=""
          aria-hidden="true"
        />
        {/* Main content */}
        <div className="flex h-full w-full flex-col items-center px-8 pt-6 pb-10">
          <div className="sticky top-0 flex w-full shrink-0 items-center justify-between gap-6">
            <VarianceLockup className="h-8" />
          </div>
          <div className="flex h-full w-full flex-col items-center justify-center gap-7">
            <div className="flex flex-col items-center gap-11">
              <img src={VarianceMarkImage} className="h-24 w-40 object-contain" alt="Variance" />
              <div className="flex max-w-124 flex-col items-center gap-3">
                <h1 className="text-h2-semibold text-primary">Welcome to Variance</h1>
                <p className="text-center text-body-md-regular text-secondary">
                  Set up your instance and create your first workspace to begin managing projects and work.
                </p>
              </div>
            </div>
            <div className="w-72">
              <Button
                variant="primary"
                size="lg"
                stretch="full"
                nativeButton={false}
                render={<a href={GOD_MODE_URL}>Get started</a>}
                label="Get started"
              />
            </div>
          </div>
        </div>
      </div>
    </DefaultLayout>
  );
}
