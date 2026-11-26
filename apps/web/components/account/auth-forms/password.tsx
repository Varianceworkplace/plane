/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// icons
import { CloseCircleOutline, HideOutline, ShowOutline, TickCircleOutline } from "@makeplane/propel/icons";
// plane imports
import { Banner } from "@makeplane/propel/components/banner";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { API_BASE_URL, E_PASSWORD_STRENGTH } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { PasswordStrengthIndicator } from "@plane/blocks/auth";
import { setToast } from "@plane/blocks/toast";
import { getPasswordStrength } from "@plane/utils";
// components
import { ForgotPasswordPopover } from "@/components/account/auth-forms/forgot-password-popover";
// constants
// helpers
import type { EAuthenticationErrorCodes } from "@/helpers/authentication.helper";
import { EAuthModes, EAuthSteps, authErrorHandler } from "@/helpers/authentication.helper";
// hooks
import useTimer from "@/hooks/use-timer";
// services
import { AuthService } from "@/services/auth.service";

type Props = {
  /** what they typed at the first step: an email address, or (signing in) a username */
  email: string;
  isSMTPConfigured: boolean;
  /** signing in to an account that has never had a password: offer to set one instead of asking for it */
  needsPasswordSetup?: boolean;
  mode: EAuthModes;
  handleEmailClear: () => void;
  handleAuthStep: (step: EAuthSteps) => void;
  nextPath: string | undefined;
};

type TPasswordFormValues = {
  email: string;
  password: string;
  confirm_password?: string;
};

const defaultValues: TPasswordFormValues = {
  email: "",
  password: "",
};

const authService = new AuthService();

export const AuthPasswordForm = observer(function AuthPasswordForm(props: Props) {
  const {
    email,
    isSMTPConfigured,
    needsPasswordSetup = false,
    handleAuthStep,
    handleEmailClear,
    mode,
    nextPath,
  } = props;
  // plane imports
  const { t } = useTranslation();
  // ref
  const formRef = useRef<HTMLFormElement>(null);
  // states
  const [csrfPromise, setCsrfPromise] = useState<Promise<{ csrf_token: string }> | undefined>(undefined);
  const [passwordFormData, setPasswordFormData] = useState<TPasswordFormValues>({ ...defaultValues, email });
  const [showPassword, setShowPassword] = useState({
    password: false,
    retypePassword: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordInputFocused, setIsPasswordInputFocused] = useState(false);
  const [isRetryPasswordInputFocused, setIsRetryPasswordInputFocused] = useState(false);
  const [isBannerMessage, setBannerMessage] = useState(false);
  // first sign-in: the emailed link to set a password
  const [isSendingSetupLink, setIsSendingSetupLink] = useState(false);
  const [isSetupLinkSent, setIsSetupLinkSent] = useState(false);
  const { timer: setupLinkTimer, setTimer: setSetupLinkTimer } = useTimer(0);
  // signing in, the first step also takes a username
  const isUsername = mode === EAuthModes.SIGN_IN && !email.includes("@");

  const handleShowPassword = (key: keyof typeof showPassword) =>
    setShowPassword((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleFormChange = (key: keyof TPasswordFormValues, value: string) =>
    setPasswordFormData((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (csrfPromise === undefined) {
      const promise = authService.requestCSRFToken();
      setCsrfPromise(promise);
    }
  }, [csrfPromise]);

  const redirectToUniqueCodeSignIn = async () => {
    handleAuthStep(EAuthSteps.UNIQUE_CODE);
  };

  // the same link as "Forgot password?", worded "set your password" in the email for a first password
  const sendPasswordSetupLink = async () => {
    setIsSendingSetupLink(true);
    try {
      await authService.sendResetPasswordLink({ email });
      setIsSetupLinkSent(true);
      setSetupLinkTimer(30);
    } catch (error: unknown) {
      const errorCode = (error as { data?: { error_code?: number | string } } | undefined)?.data?.error_code;
      const errorInfo = errorCode
        ? authErrorHandler(errorCode.toString() as EAuthenticationErrorCodes, email)
        : undefined;
      setToast({
        type: "error",
        title: t("auth.forgot_password.toast.error.title"),
        message:
          typeof errorInfo?.message === "string" ? errorInfo.message : t("auth.forgot_password.toast.error.message"),
      });
    } finally {
      setIsSendingSetupLink(false);
    }
  };

  const passwordSupport =
    mode === EAuthModes.SIGN_IN ? (
      <div className="w-full">
        {isSMTPConfigured ? (
          <Link
            href={`/accounts/forgot-password?email=${encodeURIComponent(email)}`}
            className="text-11 font-medium text-accent-primary"
          >
            {t("auth.common.forgot_password")}
          </Link>
        ) : (
          <ForgotPasswordPopover />
        )}
      </div>
    ) : (
      passwordFormData.password.length > 0 &&
      getPasswordStrength(passwordFormData.password) != E_PASSWORD_STRENGTH.STRENGTH_VALID && (
        <PasswordStrengthIndicator password={passwordFormData.password} isFocused={isPasswordInputFocused} />
      )
    );

  const isButtonDisabled = useMemo(
    () =>
      !(
        !isSubmitting &&
        !!passwordFormData.password &&
        (mode === EAuthModes.SIGN_UP ? passwordFormData.password === passwordFormData.confirm_password : true)
      ),
    [isSubmitting, mode, passwordFormData.confirm_password, passwordFormData.password]
  );

  const password = passwordFormData?.password ?? "";
  const confirmPassword = passwordFormData?.confirm_password ?? "";
  const renderPasswordMatchError = !isRetryPasswordInputFocused || confirmPassword.length >= password.length;

  const handleCSRFToken = async () => {
    if (!formRef || !formRef.current) return;
    const token = await csrfPromise;
    if (!token?.csrf_token) return;
    const csrfElement = formRef.current.querySelector("input[name=csrfmiddlewaretoken]");
    csrfElement?.setAttribute("value", token?.csrf_token);
  };

  // First sign-in to an account without a password (e.g. brought over from the old CRM): there's nothing to type
  // yet, so offer the emailed link that sets one, or a sign-in code (which then offers to set one too).
  if (mode === EAuthModes.SIGN_IN && needsPasswordSetup)
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="text-13 font-medium text-tertiary">
            {t("auth.common.username_or_email.label")}
          </label>
          <InputGroup size="2xl">
            <Input size="2xl" id="email" name="email" type={isUsername ? "text" : "email"} value={email} disabled />
            <button
              type="button"
              className="grid size-5 place-items-center"
              onClick={handleEmailClear}
              aria-label={t("aria_labels.auth_forms.clear_email")}
            >
              <CloseCircleOutline className="size-5 text-placeholder" />
            </button>
          </InputGroup>
        </div>
        <div className="space-y-1">
          <p className="text-13 font-semibold text-primary">{t("auth.password_setup.title")}</p>
          <p className="text-13 text-secondary">
            {isSMTPConfigured ? t("auth.password_setup.message") : t("auth.forgot_password.errors.smtp_not_enabled")}
          </p>
          {isSetupLinkSent && (
            <p role="status" className="flex items-start gap-1 text-11 font-medium text-success-primary">
              <TickCircleOutline height={12} width={12} className="mt-0.5 flex-shrink-0" />
              {t("auth.password_setup.link_sent")}
            </p>
          )}
        </div>
        {isSMTPConfigured && (
          <div className="space-y-2.5">
            <Button
              type="button"
              variant="primary"
              size="lg"
              stretch="full"
              onClick={sendPasswordSetupLink}
              loading={isSendingSetupLink}
              disabled={isSendingSetupLink || setupLinkTimer > 0}
              label={
                setupLinkTimer > 0
                  ? t("auth.common.resend_in", { seconds: setupLinkTimer })
                  : t("auth.password_setup.send_link")
              }
            />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              stretch="full"
              onClick={redirectToUniqueCodeSignIn}
              label={t("auth.common.sign_in_with_unique_code")}
            />
          </div>
        )}
      </div>
    );

  return (
    <>
      {isBannerMessage && mode === EAuthModes.SIGN_UP && (
        <Banner
          placement="inline"
          variant="danger"
          description={t("auth.sign_up.errors.password.strength")}
          dismissLabel={t("close")}
          onDismiss={() => setBannerMessage(false)}
        />
      )}
      <form
        ref={formRef}
        className="space-y-4"
        method="POST"
        action={`${API_BASE_URL}/auth/${mode === EAuthModes.SIGN_IN ? "sign-in" : "sign-up"}/`}
        onSubmit={async (event) => {
          event.preventDefault(); // Prevent form from submitting by default
          await handleCSRFToken();
          const isPasswordValid =
            mode === EAuthModes.SIGN_UP
              ? getPasswordStrength(passwordFormData.password) === E_PASSWORD_STRENGTH.STRENGTH_VALID
              : true;
          if (isPasswordValid) {
            setIsSubmitting(true);
            if (formRef.current) formRef.current.submit(); // Manually submit the form if the condition is met
          } else {
            setBannerMessage(true);
          }
        }}
        onError={() => {
          setIsSubmitting(false);
        }}
      >
        <input type="hidden" name="csrfmiddlewaretoken" />
        <input type="hidden" value={passwordFormData.email} name="email" />
        {nextPath && <input type="hidden" value={nextPath} name="next_path" />}
        <div className="space-y-1">
          <label htmlFor="email" className="text-13 font-medium text-tertiary">
            {mode === EAuthModes.SIGN_IN ? t("auth.common.username_or_email.label") : t("auth.common.email.label")}
          </label>
          <InputGroup size="2xl">
            <Input
              size="2xl"
              id="email"
              name="email"
              type={isUsername ? "text" : "email"}
              value={passwordFormData.email}
              onChange={(e) => handleFormChange("email", e.target.value)}
              placeholder={t("auth.common.email.placeholder")}
              disabled
            />
            {passwordFormData.email.length > 0 && (
              <button
                type="button"
                className="grid size-5 place-items-center"
                onClick={handleEmailClear}
                aria-label={t("aria_labels.auth_forms.clear_email")}
              >
                <CloseCircleOutline className="size-5 text-placeholder" />
              </button>
            )}
          </InputGroup>
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-13 font-medium text-tertiary">
            {mode === EAuthModes.SIGN_IN ? t("auth.common.password.label") : t("auth.common.password.set_password")}
          </label>
          <InputGroup size="2xl">
            <Input
              size="2xl"
              type={showPassword?.password ? "text" : "password"}
              id="password"
              name="password"
              value={passwordFormData.password}
              onChange={(e) => handleFormChange("password", e.target.value)}
              placeholder={t("auth.common.password.placeholder")}
              onFocus={() => setIsPasswordInputFocused(true)}
              onBlur={() => setIsPasswordInputFocused(false)}
              autoComplete="off"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the password is the one field to fill on this step
              autoFocus
            />
            <button
              type="button"
              onClick={() => handleShowPassword("password")}
              className="grid size-5 place-items-center"
              aria-label={t(
                showPassword?.password ? "aria_labels.auth_forms.hide_password" : "aria_labels.auth_forms.show_password"
              )}
            >
              {showPassword?.password ? (
                <HideOutline className="size-5 text-placeholder" />
              ) : (
                <ShowOutline className="size-5 text-placeholder" />
              )}
            </button>
          </InputGroup>
          {passwordSupport}
        </div>

        {mode === EAuthModes.SIGN_UP && (
          <div className="space-y-1">
            <label htmlFor="confirm-password" className="text-13 font-medium text-tertiary">
              {t("auth.common.password.confirm_password.label")}
            </label>
            <InputGroup size="2xl">
              <Input
                size="2xl"
                type={showPassword?.retypePassword ? "text" : "password"}
                id="confirm-password"
                name="confirm_password"
                value={passwordFormData.confirm_password}
                onChange={(e) => handleFormChange("confirm_password", e.target.value)}
                placeholder={t("auth.common.password.confirm_password.placeholder")}
                onFocus={() => setIsRetryPasswordInputFocused(true)}
                onBlur={() => setIsRetryPasswordInputFocused(false)}
                autoComplete="off"
              />
              <button
                type="button"
                className="grid size-5 place-items-center"
                aria-label={t(
                  showPassword?.retypePassword
                    ? "aria_labels.auth_forms.hide_password"
                    : "aria_labels.auth_forms.show_password"
                )}
                onClick={() => handleShowPassword("retypePassword")}
              >
                {showPassword?.retypePassword ? (
                  <HideOutline className="size-5 text-placeholder" />
                ) : (
                  <ShowOutline className="size-5 text-placeholder" />
                )}
              </button>
            </InputGroup>
            {!!passwordFormData.confirm_password &&
              passwordFormData.password !== passwordFormData.confirm_password &&
              renderPasswordMatchError && (
                <span className="text-13 text-danger-primary">{t("auth.common.password.errors.match")}</span>
              )}
          </div>
        )}

        <div className="space-y-2.5">
          {mode === EAuthModes.SIGN_IN ? (
            <>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                stretch="full"
                disabled={isButtonDisabled}
                loading={isSubmitting}
                label={isSMTPConfigured ? t("common.continue") : t("common.go_to_workspace")}
              />
              {isSMTPConfigured && (
                <Button
                  type="button"
                  onClick={redirectToUniqueCodeSignIn}
                  variant="secondary"
                  size="lg"
                  stretch="full"
                  label={t("auth.common.sign_in_with_unique_code")}
                />
              )}
            </>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              stretch="full"
              disabled={isButtonDisabled}
              loading={isSubmitting}
              label="Create account"
            />
          )}
        </div>
      </form>
    </>
  );
});
