from __future__ import annotations

import re
from datetime import datetime, timezone

from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$")
USERNAME_RULE = (
    "Username must be 3-32 characters, start with a letter or number, and contain only "
    "letters, numbers, dots, underscores or hyphens"
)


def normalize_username(value: str) -> str:
    value = (value or "").strip()
    if not USERNAME_RE.match(value):
        raise ValueError(USERNAME_RULE)
    return value


def normalize_email(value: str) -> str:
    from email_validator import EmailNotValidError, validate_email

    try:
        return validate_email((value or "").strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as e:
        raise ValueError("Enter a valid email address") from e


class UserDocument(BaseModel):

    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    username: str
    username_lower: str = ""
    email: EmailStr
    password_hash: str
    avatar: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "alias_generator": to_camel,
    }

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        return normalize_username(v)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str) -> str:
        return v.strip().lower()

    def model_post_init(self, __context) -> None:
        if not self.username_lower:
            self.username_lower = self.username.lower()

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True)
        d["_id"] = ObjectId(d["_id"])
        return d


def public_user(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "username": doc["username"],
        "email": doc["email"],
        "avatar": doc.get("avatar"),
        "createdAt": doc.get("createdAt") or doc.get("created_at"),
    }
