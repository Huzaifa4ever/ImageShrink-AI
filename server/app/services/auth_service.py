

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import ValidationError
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.core.security import hash_password, password_problem, verify_password
from app.models.user import UserDocument, normalize_email, normalize_username

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
        logger.info("auth: indexes ensured")
    except Exception as e: 
        logger.warning("auth: could not ensure indexes: %s", e)


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
    ok = verify_password(password, user["passwordHash"] if user else _dummy_hash())

    if not user or not ok:
        raise AuthFailed("Incorrect username/email or password")
    return user


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
