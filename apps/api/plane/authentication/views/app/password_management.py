# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
from urllib.parse import urlencode, urljoin

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from zxcvbn import zxcvbn

# Django imports
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.utils.encoding import DjangoUnicodeDecodeError, smart_bytes, smart_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views import View

# Module imports
from plane.bgtasks.forgot_password_task import forgot_password
from plane.license.models import Instance
from plane.db.models import User
from plane.authentication.adapter.base import confirm_email_ownership
from plane.license.utils.instance_value import get_configuration_value
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.utils.account_access import is_deactivated
from plane.authentication.utils.login_identifier import is_username, login_email
from plane.authentication.rate_limit import AuthenticationThrottle


def generate_password_token(user):
    uidb64 = urlsafe_base64_encode(smart_bytes(user.id))
    token = PasswordResetTokenGenerator().make_token(user)

    return uidb64, token


class ForgotPasswordEndpoint(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        # an email address, or a username (see login_identifier); the link only ever goes to the account's address
        identifier = request.data.get("email")
        email = login_email(identifier)

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST,) = get_configuration_value([{"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")}])

        if not (EMAIL_HOST):
            exc = AuthenticationException(
                error_message="SMTP_NOT_CONFIGURED",
                error_code=AUTHENTICATION_ERROR_CODES["SMTP_NOT_CONFIGURED"],
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        if str(identifier or "").strip() and is_username(identifier) and not email:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Get the user
        user = User.objects.filter(email=email).first()
        # a disabled account gets no reset link: it couldn't sign in with the new password anyway
        if is_deactivated(user):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ACCOUNT_DEACTIVATED"],
                error_message="USER_ACCOUNT_DEACTIVATED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        if user:
            # Get the reset token for user
            uidb64, token = generate_password_token(user=user)
            current_site = base_host(request=request, is_app=True)
            # send the forgot password email (worded "set your password" for someone who hasn't set one yet)
            forgot_password.delay(
                user.first_name, user.email, uidb64, token, current_site, first_time=user.is_password_autoset
            )
            return Response(
                {"message": "Check your email to reset your password"},
                status=status.HTTP_200_OK,
            )
        exc = AuthenticationException(
            error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
            error_message="USER_DOES_NOT_EXIST",
        )
        return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)


class ResetPasswordEndpoint(View):
    def post(self, request, uidb64, token):
        try:
            # Decode the id from the uidb64
            try:
                id = smart_str(urlsafe_base64_decode(uidb64))
                user = User.objects.get(id=id)
            except (ValueError, User.DoesNotExist):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD_TOKEN"],
                    error_message="INVALID_PASSWORD_TOKEN",
                )
                params = exc.get_error_dict()
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(params),
                )
                return HttpResponseRedirect(url)

            # check if the token is valid for the user
            if not PasswordResetTokenGenerator().check_token(user, token):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD_TOKEN"],
                    error_message="INVALID_PASSWORD_TOKEN",
                )
                params = exc.get_error_dict()
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(params),
                )
                return HttpResponseRedirect(url)

            # an old link doesn't reopen a disabled account
            if is_deactivated(user):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["USER_ACCOUNT_DEACTIVATED"],
                    error_message="USER_ACCOUNT_DEACTIVATED",
                )
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(exc.get_error_dict()),
                )
                return HttpResponseRedirect(url)

            password = request.POST.get("password", False)
            # a refused password keeps the (still valid) link, so they can try another one straight away
            link = {"uidb64": uidb64, "token": token, "email": user.email}
            if request.POST.get("setup") == "1":
                link["setup"] = "1"

            if not password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                    error_message="INVALID_PASSWORD",
                )
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode({**link, **exc.get_error_dict()}),
                )
                return HttpResponseRedirect(url)

            # Check the password complexity
            results = zxcvbn(password)
            if results["score"] < 3:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                    error_message="PASSWORD_TOO_WEAK",
                )
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode({**link, **exc.get_error_dict()}),
                )
                return HttpResponseRedirect(url)

            # set_password also hashes the password that the user will get
            user.set_password(password)
            user.is_password_autoset = False
            # the reset link came to their inbox: the email is theirs, and old sessions end with the old password
            confirm_email_ownership(user)
            user.save()

            # back to sign-in, which says the password is saved and has their address filled in
            url = urljoin(
                base_host(request=request, is_app=True),
                "?" + urlencode({"password_saved": "1", "email": user.email}),
            )
            return HttpResponseRedirect(url)
        except DjangoUnicodeDecodeError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EXPIRED_PASSWORD_TOKEN"],
                error_message="EXPIRED_PASSWORD_TOKEN",
            )
            url = urljoin(
                base_host(request=request, is_app=True),
                "accounts/reset-password?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)
