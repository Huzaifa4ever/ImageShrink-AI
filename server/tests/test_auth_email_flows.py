"""Google sign-in, email confirmation and password reset.

These lean on a real MongoDB (see the `mongo` fixture) because the guarantees being checked —
single-use tokens, atomic consumption, unique-index races — are database behaviour. A fake
store would reproduce the happy path and none of the protections.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.user import PROVIDER_GOOGLE, PROVIDER_PASSWORD, public_user
from app.services import auth_service, email_token_service
from app.services.email_token_service import PURPOSE_RESET, PURPOSE_VERIFY


@pytest.fixture
async def db(monkeypatch: pytest.MonkeyPatch, mongo):
    monkeypatch.setenv("EMAIL_CHECK_DELIVERABILITY", "false")
    get_settings.cache_clear()
    await email_token_service.ensure_indexes()
    try:
        yield mongo
    finally:
        get_settings.cache_clear()


def google_profile(email="ada@example.com", name="Ada Lovelace", picture=None) -> dict:
    """What google_auth.verify() returns once a token has been checked."""
    return {
        "sub": "1234567890",
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": picture,
    }


# ─── Tokens ───

async def test_a_token_works_exactly_once(db):
    token = await email_token_service.issue("user1", PURPOSE_VERIFY, timedelta(hours=1))

    assert await email_token_service.consume(token, PURPOSE_VERIFY) == "user1"
    # A second click on the same link in an email must not work.
    assert await email_token_service.consume(token, PURPOSE_VERIFY) is None


async def test_an_expired_token_is_refused(db):
    token = await email_token_service.issue("user1", PURPOSE_VERIFY, timedelta(seconds=-1))

    assert await email_token_service.consume(token, PURPOSE_VERIFY) is None


async def test_issuing_a_new_token_kills_the_old_one(db):
    first = await email_token_service.issue("user1", PURPOSE_RESET, timedelta(hours=1))
    second = await email_token_service.issue("user1", PURPOSE_RESET, timedelta(hours=1))

    # Otherwise a forwarded older email would still be a working way in.
    assert await email_token_service.consume(first, PURPOSE_RESET) is None
    assert await email_token_service.consume(second, PURPOSE_RESET) == "user1"


async def test_a_verification_token_cannot_reset_a_password(db):
    """The purposes must not be interchangeable.

    A confirmation link is handed out freely at signup. If it also worked as a password reset,
    anyone who saw one could take the account over.
    """
    token = await email_token_service.issue("user1", PURPOSE_VERIFY, timedelta(hours=1))

    assert await email_token_service.consume(token, PURPOSE_RESET) is None
    assert await email_token_service.consume(token, PURPOSE_VERIFY) == "user1"


async def test_a_made_up_token_is_refused(db):
    assert await email_token_service.consume("not-a-real-token", PURPOSE_VERIFY) is None
    assert await email_token_service.consume("", PURPOSE_VERIFY) is None


async def test_the_raw_token_is_never_stored(db):
    """A database dump must not hand over working links."""
    token = await email_token_service.issue("user1", PURPOSE_VERIFY, timedelta(hours=1))

    stored = await db["emailTokens"].find_one({"userId": "user1"})
    assert stored is not None
    assert token not in str(stored)


# ─── Google sign-in ───

async def test_google_sign_in_creates_an_account(db):
    user, created = await auth_service.upsert_google_user(google_profile())

    assert created is True
    assert user["email"] == "ada@example.com"
    assert user["authProvider"] == PROVIDER_GOOGLE
    # Google already proved the address, so no second confirmation is asked for.
    assert user["emailVerified"] is True
    # No password exists, rather than a placeholder hash somebody could try to guess.
    assert user.get("passwordHash") is None


async def test_google_sign_in_twice_reuses_the_same_account(db):
    first, created_first = await auth_service.upsert_google_user(google_profile())
    second, created_second = await auth_service.upsert_google_user(google_profile())

    assert created_first is True
    assert created_second is False
    assert str(first["_id"]) == str(second["_id"])


async def test_google_derives_a_username_from_the_display_name(db):
    """Capitalisation is kept, matching how a manually chosen username is stored."""
    user, _ = await auth_service.upsert_google_user(google_profile(name="Ada Lovelace"))

    assert user["username"] == "AdaLovelace"
    assert user["usernameLower"] == "adalovelace"


async def test_two_google_users_with_the_same_name_get_different_usernames(db):
    first, _ = await auth_service.upsert_google_user(
        google_profile(email="ada1@example.com", name="Ada Lovelace")
    )
    second, _ = await auth_service.upsert_google_user(
        google_profile(email="ada2@example.com", name="Ada Lovelace")
    )

    assert first["username"] != second["username"]
    assert second["username"].startswith("AdaLovelace")


async def test_a_google_name_that_is_all_symbols_still_yields_a_valid_username(db):
    """The username rule needs 3+ characters starting alphanumeric. '···' gives neither."""
    user, _ = await auth_service.upsert_google_user(
        google_profile(email="odd@example.com", name="!!!")
    )

    assert len(user["username"]) >= 3
    assert user["username"][0].isalnum()


async def test_google_linking_keeps_an_existing_password(db):
    """Signing up with a password then clicking Google must not remove the password.

    Overwriting it would silently take away the way that user already knows how to log in.
    """
    existing = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    original_hash = existing["passwordHash"]

    linked, created = await auth_service.upsert_google_user(google_profile())

    assert created is False
    assert linked["passwordHash"] == original_hash
    assert linked["emailVerified"] is True
    # Still a password account: it has one, so "change password" should stay available.
    assert linked.get("authProvider") == PROVIDER_PASSWORD
    assert public_user(linked)["hasPassword"] is True


async def test_google_linking_verifies_a_previously_unverified_email(db):
    await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    before = await auth_service.find_by_email("ada@example.com")
    assert before["emailVerified"] is False

    linked, _ = await auth_service.upsert_google_user(google_profile())

    assert linked["emailVerified"] is True


# ─── Password signup and verification ───

async def test_a_new_password_account_starts_unverified(db):
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")

    assert user["emailVerified"] is False
    assert user["authProvider"] == PROVIDER_PASSWORD


async def test_confirming_marks_the_account_verified(db):
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    token = await email_token_service.issue(
        str(user["_id"]), PURPOSE_VERIFY, timedelta(hours=1)
    )

    user_id = await email_token_service.consume(token, PURPOSE_VERIFY)
    updated = await auth_service.mark_email_verified(user_id)

    assert updated["emailVerified"] is True


async def test_login_is_blocked_when_verification_is_required(db, monkeypatch):
    await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")
    get_settings.cache_clear()

    with pytest.raises(auth_service.AuthInvalid, match="confirm your email"):
        await auth_service.authenticate("ada", "correct horse staple")


async def test_accounts_from_before_verification_existed_can_still_log_in(db, monkeypatch):
    """Turning verification on must not lock out anyone who signed up before it.

    Those documents have no emailVerified field at all, so the code has to treat "missing" as
    verified rather than as false.
    """
    await db["users"].insert_one(
        {
            "username": "legacy",
            "usernameLower": "legacy",
            "email": "legacy@example.com",
            "passwordHash": hash_password("correct horse staple"),
        }
    )
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")
    get_settings.cache_clear()

    user = await auth_service.authenticate("legacy", "correct horse staple")
    assert user["username"] == "legacy"
    assert public_user(user)["emailVerified"] is True


async def test_the_backfill_stamps_pre_existing_accounts(db):
    await db["users"].insert_one(
        {
            "username": "legacy",
            "usernameLower": "legacy",
            "email": "legacy@example.com",
            "passwordHash": hash_password("correct horse staple"),
        }
    )

    await auth_service._backfill_auth_fields()

    stored = await db["users"].find_one({"usernameLower": "legacy"})
    assert stored["emailVerified"] is True
    assert stored["authProvider"] == PROVIDER_PASSWORD


# ─── Password reset ───

async def test_reset_sets_a_new_working_password(db):
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    token = await email_token_service.issue(
        str(user["_id"]), PURPOSE_RESET, timedelta(minutes=30)
    )

    user_id = await email_token_service.consume(token, PURPOSE_RESET)
    await auth_service.set_password(user_id, "a whole new password")

    assert await auth_service.authenticate("ada", "a whole new password")
    with pytest.raises(auth_service.AuthFailed):
        await auth_service.authenticate("ada", "correct horse staple")


async def test_reset_refuses_to_reuse_the_current_password(db):
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")

    with pytest.raises(auth_service.AuthInvalid, match="different"):
        await auth_service.set_password(str(user["_id"]), "correct horse staple")


async def test_reset_rejects_a_weak_password(db):
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")

    with pytest.raises(auth_service.AuthInvalid):
        await auth_service.set_password(str(user["_id"]), "short")


async def test_reset_confirms_the_email_too(db):
    """Clicking a link in that inbox is proof of owning it."""
    user = await auth_service.create_user("ada", "ada@example.com", "correct horse staple")
    assert user["emailVerified"] is False

    await auth_service.set_password(str(user["_id"]), "a whole new password")

    updated = await auth_service.find_by_email("ada@example.com")
    assert updated["emailVerified"] is True


async def test_reset_gives_a_google_only_account_a_password(db):
    """Someone who signed up with Google should be able to add a password this way."""
    user, _ = await auth_service.upsert_google_user(google_profile())
    assert user.get("passwordHash") is None

    await auth_service.set_password(str(user["_id"]), "a brand new password")

    assert await auth_service.authenticate("ada@example.com", "a brand new password")


async def test_a_google_only_account_cannot_be_logged_into_with_a_blank_password(db):
    """No password means no password login — not "any password works"."""
    await auth_service.upsert_google_user(google_profile())

    for attempt in ("", "guess", "None", "null"):
        with pytest.raises(auth_service.AuthFailed):
            await auth_service.authenticate("ada@example.com", attempt)


async def test_looking_up_an_unknown_email_returns_nothing(db):
    assert await auth_service.find_by_email("nobody@example.com") is None
    # Garbage must not raise — the forgot-password endpoint passes user input straight in.
    assert await auth_service.find_by_email("not-an-email") is None
