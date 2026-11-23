/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// components
import { AuthBase } from "@/components/auth-screens/auth-base";
// helpers
import { EAuthModes, EPageTypes } from "@/helpers/authentication.helper";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
import { useAppRouter } from "@/hooks/use-app-router";
// assets
import DefaultLayout from "@/layouts/default-layout";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

const SignUpPage = observer(function SignUpPage() {
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { config } = useInstance();
  // With sign-up turned off there's no open sign-up form: invited people start from the sign-in page, which
  // creates their account once they enter their email (keeping where they were going).
  const signUpOff = config?.enable_signup === false;

  useEffect(() => {
    if (!signUpOff) return;
    const query = searchParams.toString();
    router.replace(query ? `/?${query}` : "/");
  }, [signUpOff, searchParams, router]);

  if (signUpOff) return null;

  return (
    <DefaultLayout>
      <AuthenticationWrapper pageType={EPageTypes.NON_AUTHENTICATED}>
        <AuthBase authType={EAuthModes.SIGN_UP} />
      </AuthenticationWrapper>
    </DefaultLayout>
  );
});

export default SignUpPage;
