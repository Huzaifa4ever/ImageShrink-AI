

from __future__ import annotations

from app.services.dockerfile_lexer import parse, parse_from, stage_names


def test_records_one_based_line_numbers():
    parsed = parse("FROM alpine:3.20\nWORKDIR /app\nCMD [\"sh\"]\n")

    assert [(i.keyword, i.line) for i in parsed.instructions] == [
        ("FROM", 1),
        ("WORKDIR", 2),
        ("CMD", 3),
    ]


def test_joins_line_continuations_into_one_instruction():
    content = 'FROM alpine\nRUN apk add --no-cache curl \\\n    && rm -rf /tmp/* \\\n    && echo done\nCMD ["sh"]\n'
    parsed = parse(content)

    run = parsed.of("RUN")[0]
    assert run.value == "apk add --no-cache curl && rm -rf /tmp/* && echo done"
    assert run.line == 2
    assert run.end_line == 4
    assert run.is_multiline
    # The original text is preserved so quick fixes can keep the author's formatting.
    assert run.raw.count("\n") == 2

    # The instruction after a continuation must not be swallowed.
    assert [i.keyword for i in parsed.instructions] == ["FROM", "RUN", "CMD"]


def test_a_comment_inside_a_continuation_does_not_end_the_instruction():
    content = "FROM alpine\nRUN apk add curl \\\n    # we need git too\n    && apk add git\n"
    parsed = parse(content)

    runs = parsed.of("RUN")
    assert len(runs) == 1
    assert runs[0].value == "apk add curl && apk add git"
    assert runs[0].end_line == 4


def test_blank_lines_and_comments_are_skipped():
    parsed = parse("# a comment\n\nFROM alpine\n\n# another\nCMD [\"sh\"]\n")

    assert [i.keyword for i in parsed.instructions] == ["FROM", "CMD"]
    assert parsed.of("FROM")[0].line == 3


def test_captures_parser_directives_before_the_first_instruction():
    parsed = parse("# syntax=docker/dockerfile:1\n# escape=`\nFROM alpine\n")

    assert parsed.directives == {"syntax": "docker/dockerfile:1", "escape": "`"}


def test_ignores_a_directive_shaped_comment_after_the_first_instruction():
    parsed = parse("FROM alpine\n# syntax=nonsense\n")
    assert parsed.directives == {}


def test_tracks_stage_membership_and_count():
    content = (
        "ARG NODE_VERSION=22\n"
        "FROM node:22 AS builder\n"
        "RUN npm ci\n"
        "FROM node:22-alpine\n"
        "COPY --from=builder /app /app\n"
    )
    parsed = parse(content)

    assert parsed.stage_count == 2
    assert parsed.final_stage_index == 1
    assert parsed.of("ARG")[0].stage_index == -1
    assert parsed.of("RUN")[0].stage_index == 0
    assert parsed.of("COPY")[0].stage_index == 1


def test_lowercase_instructions_are_normalized():
    parsed = parse("from alpine:3.20\nrun echo hi\n")
    assert [i.keyword for i in parsed.instructions] == ["FROM", "RUN"]


def test_unknown_leading_words_are_not_treated_as_instructions():
    parsed = parse("FROM alpine\nsome stray text\nCMD [\"sh\"]\n")
    assert [i.keyword for i in parsed.instructions] == ["FROM", "CMD"]


def test_column_of_locates_text_on_the_right_line():
    content = "FROM alpine\nRUN apk add curl \\\n    && sudo rm -rf /tmp\n"
    parsed = parse(content)
    run = parsed.of("RUN")[0]

    line, column, end_line, end_column = run.column_of("sudo")

    assert (line, end_line) == (3, 3)
    assert content.split("\n")[line - 1][column - 1 : end_column - 1] == "sudo"


def test_column_of_falls_back_to_the_full_span_when_text_is_absent():
    parsed = parse("FROM alpine\n")
    instruction = parsed.of("FROM")[0]
    assert instruction.column_of("nonexistent") == instruction.full_span()


def _ref(from_line: str, aliases=frozenset()):
    parsed = parse(from_line if from_line.endswith("\n") else from_line + "\n")
    return parse_from(parsed.of("FROM")[0], set(aliases))


def test_parses_a_plain_image_and_tag():
    ref = _ref("FROM node:22.11-alpine")
    assert (ref.registry, ref.path, ref.tag, ref.name) == (None, "node", "22.11-alpine", "node")
    assert ref.is_slim_variant


def test_parses_an_untagged_image():
    ref = _ref("FROM node")
    assert ref.tag is None


def test_parses_a_registry_host_but_not_a_hub_namespace():
    hosted = _ref("FROM gcr.io/distroless/static-debian12:nonroot")
    assert hosted.registry == "gcr.io"
    assert hosted.path == "distroless/static-debian12"
    assert hosted.is_distroless

    namespaced = _ref("FROM library/node:22")
    assert namespaced.registry is None
    assert namespaced.path == "library/node"
    assert namespaced.name == "node"


def test_parses_a_registry_with_a_port():
    ref = _ref("FROM localhost:5000/myapp:1.2.3")
    assert ref.registry == "localhost:5000"
    assert ref.path == "myapp"
    assert ref.tag == "1.2.3"


def test_parses_a_digest():
    ref = _ref("FROM node:22@sha256:abc123")
    assert ref.digest == "sha256:abc123"
    assert ref.tag == "22"


def test_ignores_platform_flags_and_reads_the_alias():
    ref = _ref("FROM --platform=linux/amd64 node:22-alpine AS builder")
    assert ref.path == "node"
    assert ref.alias == "builder"


def test_recognises_a_reference_to_an_earlier_stage():
    ref = _ref("FROM builder AS final", aliases={"builder"})
    assert ref.is_stage_reference
    assert ref.path == "builder"


def test_recognises_scratch():
    assert _ref("FROM scratch").is_scratch


def test_stage_names_collects_aliases():
    content = "FROM node:22 AS builder\nFROM node:22 as Deps\nFROM alpine\n"
    assert stage_names(parse(content)) == {"builder", "Deps"}
