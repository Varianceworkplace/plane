# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os

# Django imports
from django.core.validators import validate_email
from django.core.exceptions import ValidationError

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

## Module imports
from plane.db.models import User
from plane.license.models import Instance
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.authentication.utils.account_access import is_deactivated, password_login_enabled, signup_allowed
from plane.authentication.utils.login_identifier import is_username, login_email
from plane.license.utils.instance_value import get_configuration_value


class EmailCheckEndpoint(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST, ENABLE_MAGIC_LINK_LOGIN) = get_configuration_value(
            [
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST", "")},
                {
                    "key": "ENABLE_MAGIC_LINK_LOGIN",
                    "default": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "1"),
                },
            ]
        )

        smtp_configured = bool(EMAIL_HOST)
        is_magic_login_enabled = ENABLE_MAGIC_LINK_LOGIN == "1"
        is_password_login_enabled = password_login_enabled()

        # an email address, or a username (see login_identifier)
        identifier = request.data.get("email", False)

        # Return error if email is not present
        if not identifier or not str(identifier).strip():
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_REQUIRED"],
                error_message="EMAIL_REQUIRED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        email = login_email(identifier)
        # a username nobody has: there's no account to sign in to, and a username can't sign up
        if is_username(identifier) and not email:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Validate email
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        # Check if a user already exists with the given email
        existing_user = User.objects.filter(email=email).first()

        # Say straight away when nothing can follow (rather than after a password form or an emailed code):
        # a disabled account, or a new address while sign-up is off and it has no open invitation.
        if is_deactivated(existing_user):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ACCOUNT_DEACTIVATED"],
                error_message="USER_ACCOUNT_DEACTIVATED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        if not existing_user and not signup_allowed(email):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["SIGNUP_DISABLED"],
                error_message="SIGNUP_DISABLED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # If existing user
        if existing_user:
            # The password step comes next whenever passwords are on: someone who hasn't set one yet is offered a
            # link to set it, or a sign-in code, from there (is_password_autoset). Only with passwords off does a
            # sign-in code go out straight away.
            code_only = (
                existing_user.is_password_autoset
                and smtp_configured
                and is_magic_login_enabled
                and not is_password_login_enabled
            )
            return Response(
                {
                    "existing": True,
                    "status": "MAGIC_CODE" if code_only else "CREDENTIAL",
                    "is_password_autoset": existing_user.is_password_autoset,
                },
                status=status.HTTP_200_OK,
            )
        # Else return response
        return Response(
            {
                "existing": False,
                "status": ("MAGIC_CODE" if smtp_configured and is_magic_login_enabled else "CREDENTIAL"),
                "is_password_autoset": False,
            },
            status=status.HTTP_200_OK,
        )
