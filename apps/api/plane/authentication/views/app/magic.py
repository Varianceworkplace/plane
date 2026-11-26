# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.views import View

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.authentication.provider.credentials.magic_code import MagicCodeProvider
from plane.authentication.utils.login import user_login
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.bgtasks.magic_link_code_task import magic_link
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.db.models import User, Profile
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.utils.account_access import is_deactivated, password_login_enabled, signup_allowed
from plane.authentication.utils.login_identifier import as_typed, is_username, login_email
from plane.authentication.rate_limit import (
    AuthenticationThrottle,
    throttle_auth_redirect,
)
from plane.utils.path_validator import get_safe_redirect_url


class MagicGenerateEndpoint(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        # Check if instance is configured
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # an email address, or a username (see login_identifier)
        identifier = str(request.data.get("email", "") or "").strip()
        email = login_email(identifier)
        try:
            if is_username(identifier):
                # a username must be someone's (it can't sign up), and whose address it is stays private
                if not email:
                    raise AuthenticationException(
                        error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                        error_message="USER_DOES_NOT_EXIST",
                    )
            validate_email(email)
            # no code for a disabled account, or for a new address that can't sign up
            user = User.objects.filter(email=email).first()
            if is_deactivated(user):
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["USER_ACCOUNT_DEACTIVATED"],
                    error_message="USER_ACCOUNT_DEACTIVATED",
                )
            if not user and not signup_allowed(email):
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["SIGNUP_DISABLED"],
                    error_message="SIGNUP_DISABLED",
                )
            adapter = MagicCodeProvider(request=request, key=email)
            key, token = adapter.initiate()
            # If the smtp is configured send through here
            magic_link.delay(email, key, token)
            # the key names the address: only for an address that was typed
            return Response({"key": "" if is_username(identifier) else str(key)}, status=status.HTTP_200_OK)
        except AuthenticationException as e:
            params = e.get_error_dict()
            return Response(params, status=status.HTTP_400_BAD_REQUEST)


class MagicSignInEndpoint(View):
    @throttle_auth_redirect(is_app=True)
    def post(self, request):
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        # an email address, or a username (see login_identifier): errors go back with what was typed
        identifier = request.POST.get("email", "").strip()
        email = login_email(identifier)
        next_path = request.POST.get("next_path")

        if code == "" or identifier == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # Existing User
        existing_user = User.objects.filter(email=email).first()

        if not existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = MagicCodeProvider(
                request=request,
                key=f"magic_{email}",
                code=code,
                callback=post_user_auth_workflow,
            )
            user = provider.authenticate()
            profile, _ = Profile.objects.get_or_create(user=user)
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            if next_path:
                # back to where they were going (e.g. the invitation they opened)
                path = str(next_path)
            elif user.is_password_autoset and profile.is_onboarded:
                # No password yet: offer to set one now (it can be skipped), so the password works next time.
                # The web app's root opens next_path for someone signed in.
                path = "/accounts/set-password" if password_login_enabled() else "/"
            else:
                # Get the redirection path
                path = str(get_redirection_path(user=user))
            # redirect to referer path
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=path,
                params={},
            )
            return HttpResponseRedirect(url)

        except AuthenticationException as e:
            params = as_typed(e.get_error_dict(), identifier)
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)


class MagicSignUpEndpoint(View):
    @throttle_auth_redirect(is_app=True)
    def post(self, request):
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        email = request.POST.get("email", "").strip().lower()
        next_path = request.POST.get("next_path")

        if code == "" or email == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
        # Existing user
        existing_user = User.objects.filter(email=email).first()
        if existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                error_message="USER_ALREADY_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = MagicCodeProvider(
                request=request,
                key=f"magic_{email}",
                code=code,
                callback=post_user_auth_workflow,
            )
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            # Get the redirection path
            if next_path:
                path = next_path
            else:
                path = get_redirection_path(user=user)
            # redirect to referer path
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=path,
                params={},
            )
            return HttpResponseRedirect(url)

        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
