/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
// components
import { AuthRoot } from "@/components/account/auth-forms/auth-root";
// helpers
import { EAuthModes } from "@/helpers/authentication.helper";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
// local imports
import { AuthHeaderBase } from "./header";

// Decorative shapes in the Variance logo colours (blue, orange, teal).
function LoginArtwork() {
  return (
    <div className="relative hidden h-full w-1/2 items-center justify-center overflow-hidden lg:flex">
      <div className="absolute -top-24 -left-20 size-72 rounded-full bg-gradient-to-br from-[#4083E9]/20 to-[#00D4C8]/10" />
      <div className="absolute -top-32 left-[30%] size-64 rounded-full bg-[linear-gradient(to_right,#A8C7F5_50%,#4083E9_50%)] opacity-90" />
      <div className="absolute -top-28 right-[6%] size-56 rounded-full bg-[#FF9334]/80" />
      <div className="absolute top-[18%] -right-24 size-48 rounded-full bg-[#00D4C8]/60" />
      <div className="absolute top-[26%] right-[20%] h-20 w-28 bg-[radial-gradient(#4083E9_1.5px,transparent_1.5px)] [background-size:14px_14px] opacity-40" />
      <div className="absolute top-[56%] left-[16%] size-14 rotate-12 rounded-tl-full bg-[#FF9334]/70" />
      <div className="absolute bottom-[10%] left-[32%] h-40 w-24 rounded-t-full bg-gradient-to-b from-[#FF9334] to-[#FF6A3D]" />
      <div className="absolute -bottom-16 left-[50%] size-44 rounded-full bg-[#00D4C8]/55" />
      <div className="absolute right-[8%] bottom-[18%] size-28 -rotate-12 bg-[#4083E9]/40 [clip-path:polygon(50%_0%,100%_100%,0%_100%)]" />
      <p className="relative text-center text-h2-medium text-primary">
        Grow through Innovation
        <br />
        with <span className="font-semibold">VarianceInfoTech</span>
      </p>
    </div>
  );
}

export const LoginScreen = observer(function LoginScreen() {
  // store hooks
  const { config } = useInstance();
  // derived values
  const enableSignUpConfig = config?.enable_signup ?? false;

  return (
    <div className="relative z-10 flex h-screen w-screen overflow-hidden">
      <div className="flex h-full w-full flex-col overflow-y-auto px-8 pt-6 pb-10 lg:w-1/2">
        <AuthHeaderBase pageTitle="Sign in" brandName="VarianceInfoTech" />
        <div className="flex flex-grow flex-col items-center justify-center">
          <div className="w-full">
            <AuthRoot authMode={EAuthModes.SIGN_IN} />
          </div>
          {enableSignUpConfig && (
            <p className="text-center text-body-sm-regular text-tertiary">
              New to VarianceInfoTech?{" "}
              <Link href="/sign-up" className="text-body-sm-semibold text-accent-primary hover:underline">
                Create an account
              </Link>
            </p>
          )}
        </div>
      </div>
      <LoginArtwork />
    </div>
  );
});
