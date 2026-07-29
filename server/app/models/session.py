
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel

ClientKind = Literal["web", "vscode", "cli", "unknown"]


class ClientInfo(BaseModel):

    kind: ClientKind = "unknown"
    name: str = ""
    version: str = ""
    platform: str = ""

    model_config = {"populate_by_name": True, "alias_generator": to_camel}


class SessionDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    user_id: str

    refresh_token_hash: str
    previous_token_hash: str | None = None

    client: ClientInfo = ClientInfo()
    ip: str = ""
    user_agent: str = ""

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_seen_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime
    revoked_at: datetime | None = None
    revoked_reason: str = ""

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "alias_generator": to_camel,
    }

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True)
        d["_id"] = ObjectId(d["_id"])
        return d


def public_session(doc: dict, current_session_id: str | None = None) -> dict:
    client = doc.get("client") or {}
    return {
        "id": str(doc["_id"]),
        "client": {
            "kind": client.get("kind", "unknown"),
            "name": client.get("name", ""),
            "version": client.get("version", ""),
            "platform": client.get("platform", ""),
        },
        "ip": doc.get("ip", ""),
        "createdAt": doc.get("createdAt"),
        "lastSeenAt": doc.get("lastSeenAt"),
        "expiresAt": doc.get("expiresAt"),
        "isCurrent": current_session_id is not None and str(doc["_id"]) == current_session_id,
    }
