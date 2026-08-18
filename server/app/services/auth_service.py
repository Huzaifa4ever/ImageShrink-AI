

from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import ValidationError
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.core.security import hash_password, password_problem, verify_password
from app.models.user import (
    PROVIDER_GOOGLE,
    PROVIDER_PASSWORD,
    UserDocument,
    normalize_email,
    normalize_username,
)

logger = logging.getLogger(__name__)

_dummy_hash_cache: str | None = None


class AuthConflict(Exception):
    """A username or email is already taken."""


class AuthInvalid(Exception):
    """Input failed validation."""


class AuthFailed(Exception):
    """Credentials did not match."""


def _users():
    return get_db()["users"]


async def ensure_indexes() -> None:
    try:
        await _users().create_index([("usernameLower", ASCENDING)], unique=True, name="uniq_username")
        await _users().create_index([("email", ASCENDING)], unique=True, name="uniq_email")
        await get_db()["analyses"].create_index(
            [("userId", ASCENDING), ("createdAt", DESCENDING)], name="owner_recent"
        )
        await _backfill_auth_fields()
        logger.info("auth: indexes ensured")
    except Exception as e:
        logger.warning("auth: could not ensure indexes: %s", e)


async def _backfill_auth_fields() -> None:
    """Backfill accounts predating Google sign-in and email verification.

    Marked verified on purpose: they signed up when confirming was not asked of them.
    Idempotent — the filter stops matching once it has run.
    """
    result = await _users().update_many(
        {"emailVerified": {"$exists": False}},
        {"$set": {"emailVerified": True, "authProvider": PROVIDER_PASSWORD}},
    )
    if result.modified_count:
        logger.info("auth: backfilled %d pre-existing account(s)", result.modified_count)


async def get_user_by_id(user_id: str) -> dict | None:
    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        return None
    return await _users().find_one({"_id": oid})


async def _find_by_identifier(identifier: str) -> dict | None:
    """Look a user up by either email or username, both case-insensitively."""
    key = identifier.strip().lower()
    return await _users().find_one({"$or": [{"email": key}, {"usernameLower": key}]})


async def create_user(username: str, email: str, password: str) -> dict:
    problem = password_problem(password)
    if problem:
        raise AuthInvalid(problem)

    try:
        doc = UserDocument(
            username=username,
            email=email,
            password_hash=hash_password(password),
        )
    except ValidationError as e:
        raise AuthInvalid(e.errors()[0].get("msg", "Invalid signup details")) from e

    if await _users().find_one({"usernameLower": doc.username_lower}):
        raise AuthConflict("That username is already taken")
    if await _users().find_one({"email": doc.email}):
        raise AuthConflict("An account with that email already exists")

    try:
        await _users().insert_one(doc.to_mongo())
    except DuplicateKeyError as e:
        field = "username" if "username" in str(e) else "email"
        raise AuthConflict(f"That {field} is already taken") from e

    created = await get_user_by_id(doc.id)
    if created is None:
        raise AuthInvalid("Account could not be created")
    return created


def _dummy_hash() -> str:
    global _dummy_hash_cache
    if _dummy_hash_cache is None:
        _dummy_hash_cache = hash_password(secrets.token_urlsafe(16))
    return _dummy_hash_cache


async def authenticate(identifier: str, password: str) -> dict:
    user = await _find_by_identifier(identifier)

    # A Google-only account has no password hash. Compare against the dummy anyway, so the
    # response takes the same time as a wrong password and does not leak which accounts exist
    # or how they were created.
    stored = (user or {}).get("passwordHash") or _dummy_hash()
    ok = verify_password(password, stored)

    if not user or not user.get("passwordHash") or not ok:
        raise AuthFailed("Incorrect username/email or password")

    from app.core.config import get_settings

    if get_settings().EMAIL_VERIFICATION_REQUIRED and not user.get("emailVerified", True):
        raise AuthInvalid(
            "Please confirm your email address first. Check your inbox for the link."
        )
    return user


async def _unique_username_from(base: str) -> str:
    """Turn a Google display name into a free username, e.g. 'Ada Lovelace' -> 'adalovelace'."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", (base or "").replace(" ", "")) or "user"
    cleaned = cleaned[:28]
    if len(cleaned) < 3:
        cleaned = f"{cleaned}user"[:28]

    candidate = cleaned
    for _ in range(50):
        if not await _users().find_one({"usernameLower": candidate.lower()}):
            return candidate
        candidate = f"{cleaned[:24]}{secrets.randbelow(10_000)}"
    raise AuthConflict("Could not pick a username for that account")


async def upsert_google_user(profile: dict) -> tuple[dict, bool]:
    """Sign in with a verified Google profile, creating or linking as needed.

    Matching is by email, safe only because the caller already checked Google's email_verified
    flag — otherwise anyone could claim someone else's address.
    """
    email = normalize_email(profile["email"])
    existing = await _users().find_one({"email": email})
    now = datetime.now(timezone.utc)

    if existing:
        # Linking, not overwriting. An existing password keeps working, so someone who signed
        # up with a password and later clicks the Google button does not lose their old way in.
        updates: dict = {"emailVerified": True, "updatedAt": now}
        if not existing.get("avatar") and profile.get("picture"):
            updates["avatar"] = profile["picture"]
        if not existing.get("passwordHash"):
            updates["authProvider"] = PROVIDER_GOOGLE
        await _users().update_one({"_id": existing["_id"]}, {"$set": updates})

        linked = await get_user_by_id(str(existing["_id"]))
        if linked is None:
            raise AuthFailed("Account no longer exists")
        return linked, False

    username = await _unique_username_from(profile.get("name") or email.split("@")[0])
    doc = UserDocument(
        username=username,
        email=email,
        password_hash=None,
        auth_provider=PROVIDER_GOOGLE,
        email_verified=True,
        avatar=profile.get("picture"),
    )

    try:
        await _users().insert_one(doc.to_mongo())
    except DuplicateKeyError as e:
        # Another request created the same account in the gap. Use theirs.
        raced = await _users().find_one({"email": email})
        if raced is None:
            raise AuthConflict("That account already exists") from e
        return raced, False

    created = await get_user_by_id(doc.id)
    if created is None:
        raise AuthInvalid("Account could not be created")
    return created, True


async def mark_email_verified(user_id: str) -> dict | None:
    await _users().update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"emailVerified": True, "updatedAt": datetime.now(timezone.utc)}},
    )
    return await get_user_by_id(user_id)


async def find_by_email(email: str) -> dict | None:
    try:
        clean = normalize_email(email)
    except ValueError:
        return None
    return await _users().find_one({"email": clean})


async def set_password(user_id: str, new_password: str) -> None:
    """Set a password without knowing the old one. For the reset-by-email flow only.

    Also gives a Google-only account a password, which is the point.
    """
    problem = password_problem(new_password)
    if problem:
        raise AuthInvalid(problem)

    user = await get_user_by_id(user_id)
    if user is None:
        raise AuthFailed("Account no longer exists")

    if user.get("passwordHash") and verify_password(new_password, user["passwordHash"]):
        raise AuthInvalid("New password must be different from the current one")

    await _users().update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "passwordHash": hash_password(new_password),
                # Reaching this proves control of the inbox.
                "emailVerified": True,
                "updatedAt": datetime.now(timezone.utc),
            }
        },
    )


async def update_profile(user_id: str, username: str | None, email: str | None) -> dict:
    updates: dict = {}

    if username is not None:
        try:
            clean = normalize_username(username)
        except ValueError as e:
            raise AuthInvalid(str(e)) from e
        lower = clean.lower()
        if await _users().find_one({"usernameLower": lower, "_id": {"$ne": ObjectId(user_id)}}):
            raise AuthConflict("That username is already taken")
        updates["username"] = clean
        updates["usernameLower"] = lower

    if email is not None:
        try:
            clean_email = normalize_email(email)
        except ValueError as e:
            raise AuthInvalid(str(e)) from e
        if await _users().find_one({"email": clean_email, "_id": {"$ne": ObjectId(user_id)}}):
            raise AuthConflict("An account with that email already exists")
        updates["email"] = clean_email

    if not updates:
        raise AuthInvalid("Nothing to update")

    updates["updatedAt"] = datetime.now(timezone.utc)
    try:
        await _users().update_one({"_id": ObjectId(user_id)}, {"$set": updates})
    except DuplicateKeyError as e:
        raise AuthConflict("Those details are already in use") from e

    updated = await get_user_by_id(user_id)
    if updated is None:
        raise AuthFailed("Account no longer exists")
    return updated


async def change_password(user_id: str, current_password: str, new_password: str) -> None:
    user = await get_user_by_id(user_id)
    if user is None:
        raise AuthFailed("Account no longer exists")

    if not verify_password(current_password, user["passwordHash"]):
        raise AuthFailed("Current password is incorrect")

    problem = password_problem(new_password)
    if problem:
        raise AuthInvalid(problem)
    if verify_password(new_password, user["passwordHash"]):
        raise AuthInvalid("New password must be different from the current one")

    await _users().update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"passwordHash": hash_password(new_password), "updatedAt": datetime.now(timezone.utc)}},
    )
