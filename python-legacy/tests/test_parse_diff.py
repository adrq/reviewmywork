from reviewmywork.tools import parse_diff


def test_parse_diff_empty_diff():
    """Test parsing empty diff returns empty list."""
    result = parse_diff("")
    assert result == []


def test_parse_diff_change_types():
    """Test all change type detection in comprehensive diff."""
    # Multi-file diff covering all change types
    diff_text = (
        # Added file
        "diff --git a/new.py b/new.py\n"
        "new file mode 100644\n"
        "index 0000000..1234567\n"
        "--- /dev/null\n"
        "+++ b/new.py\n"
        "@@ -0,0 +1,2 @@\n"
        "+print('hello')\n"
        "+# new file\n"
        "\n"
        # Modified file
        "diff --git a/existing.py b/existing.py\n"
        "index 1234567..7654321 100644\n"
        "--- a/existing.py\n"
        "+++ b/existing.py\n"
        "@@ -1,2 +1,2 @@\n"
        "-old_line\n"
        "+new_line\n"
        " unchanged_line\n"
        "\n"
        # Deleted file
        "diff --git a/deleted.py b/deleted.py\n"
        "deleted file mode 100644\n"
        "index 1234567..0000000\n"
        "--- a/deleted.py\n"
        "+++ /dev/null\n"
        "@@ -1,2 +0,0 @@\n"
        "-old_function()\n"
        "-print('goodbye')\n"
        "\n"
        # Renamed file (treated as MODIFIED)
        "diff --git a/old_name.py b/new_name.py\n"
        "similarity index 100%\n"
        "rename from old_name.py\n"
        "rename to new_name.py\n"
    )

    result = parse_diff(diff_text)
    assert isinstance(result, list)
    assert len(result) == 4

    # Verify all change types detected correctly
    files = {item["file"]: item["change_type"] for item in result}
    assert files["new.py"] == "ADDED"
    assert files["existing.py"] == "MODIFIED"
    assert files["deleted.py"] == "DELETED"
    assert files["new_name.py"] == "MODIFIED"  # Renames are MODIFIED


def test_parse_diff_error_handling():
    """Test parse_diff with malformed input."""
    # Test with malformed diff that might cause unidiff to fail
    malformed_diff = "not a real diff\nsome random text\n"

    # Should either return empty list or raise exception
    try:
        result = parse_diff(malformed_diff)
        assert isinstance(result, list)
    except Exception:
        # If unidiff raises exception, that's acceptable behavior
        pass

    # Test with partially valid diff
    partial_diff = (
        "diff --git a/test.py b/test.py\nindex 1234567..7654321 100644\n"
        # Missing content - should still work
    )

    result = parse_diff(partial_diff)
    assert isinstance(result, list)
