"""Copy every collection from one MongoDB to another. The source is never modified.

    PYTHONPATH=. ./venv/bin/python scripts/migrate_to_atlas.py "mongodb+srv://..."

Safe to re-run: documents are matched on _id and replaced. Refuses to write into a target that
already holds documents unless --force. Indexes are not copied — the app rebuilds them from
ensure_indexes() on startup, so this cannot drift from the real definitions.
"""

from __future__ import annotations

import argparse
import sys

from pymongo import MongoClient, ReplaceOne
from pymongo.errors import PyMongoError

BATCH = 500
SYSTEM_DBS = {"admin", "config", "local"}


def _connect(uri: str, label: str) -> MongoClient:
    client = MongoClient(uri, serverSelectionTimeoutMS=15000, tz_aware=True)
    try:
        client.admin.command("ping")
    except PyMongoError as exc:
        print(f"cannot reach the {label} database: {exc}")
        raise SystemExit(1) from exc
    return client


def _copy_collection(source, target, name: str) -> int:
    """Replace-by-_id every document. Returns how many were written."""
    written = 0
    batch: list[ReplaceOne] = []

    for doc in source[name].find({}):
        batch.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
        if len(batch) >= BATCH:
            target[name].bulk_write(batch, ordered=False)
            written += len(batch)
            batch = []

    if batch:
        target[name].bulk_write(batch, ordered=False)
        written += len(batch)

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target_uri", help="destination connection string, e.g. the Atlas one")
    parser.add_argument("--source-uri", default="mongodb://localhost:27017")
    parser.add_argument("--source-db", default="imageshrink_ai")
    parser.add_argument("--target-db", default=None, help="defaults to the source database name")
    parser.add_argument(
        "--force",
        action="store_true",
        help="write even if the target already holds documents",
    )
    args = parser.parse_args()

    target_db_name = args.target_db or args.source_db

    source_client = _connect(args.source_uri, "source")
    target_client = _connect(args.target_uri, "target")

    source = source_client[args.source_db]
    target = target_client[target_db_name]

    collections = sorted(source.list_collection_names())
    if not collections:
        print(f"'{args.source_db}' has no collections. Nothing to migrate.")
        return 1

    print(f"source : {args.source_db} ({len(collections)} collections)")
    print(f"target : {target_db_name}\n")

    # Look before writing. A target that already holds data is almost always a mistake —
    # either the wrong cluster, or a migration that already happened.
    occupied = {
        name: target[name].count_documents({})
        for name in collections
        if name in target.list_collection_names()
    }
    occupied = {name: count for name, count in occupied.items() if count}

    if occupied and not args.force:
        print("the target already holds documents:\n")
        for name, count in sorted(occupied.items()):
            print(f"   {name:20s} {count:6d} docs")
        print(
            "\nRefusing to write, in case this is the wrong cluster. If you meant to merge "
            "into it, re-run with --force. Matching _id values would be overwritten."
        )
        return 1

    failed = False
    for name in collections:
        expected = source[name].count_documents({})
        if not expected:
            print(f"   {name:20s}      0 docs   skipped (empty)")
            continue

        written = _copy_collection(source, target, name)
        actual = target[name].count_documents({})
        ok = actual >= expected

        if not ok:
            failed = True
        print(
            f"   {name:20s} {written:6d} written   target now holds {actual}"
            f"{'' if ok else '   MISMATCH'}"
        )

    if failed:
        print("\nAt least one collection came up short. The source is untouched — investigate "
              "before pointing the app at the target.")
        return 1

    print(
        "\nEvery collection copied. The source database was not modified.\n"
        "Next: put the target connection string in server/.env as MONGO_URI and restart the "
        "app — it recreates its own indexes on startup."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
