# Copyright (c) 2025 Adrian Quiroga
# Licensed under the MIT License

import os
import sys
import subprocess
from typing import Dict, List, Any
from unidiff import PatchSet


def parse_diff(diff_text: str) -> List[Dict[str, str]]:
    """Parse unified diff to extract file paths and change types."""
    patch = PatchSet(diff_text.splitlines(keepends=True))
    results: List[Dict[str, str]] = []

    for patched_file in patch:
        file_path = patched_file.path or patched_file.source_file

        if patched_file.is_added_file:
            change_type = "ADDED"
        elif patched_file.is_removed_file:
            change_type = "DELETED"
        else:
            change_type = "MODIFIED"

        results.append({"file": file_path, "change_type": change_type})

    return results


def read_file(file_path: str, session_state: Dict[str, Any] = None) -> str:
    """
    Read complete file content as string.

    Args:
        file_path: Path to the file to read (relative paths resolved against repo root)
        session_state: Session state containing repository context

    Returns:
        File content as string, or error message if failed
    """
    if not os.path.isabs(file_path) and session_state and "repo_root" in session_state:
        file_path = os.path.join(session_state["repo_root"], file_path)

    if session_state and "parsed_diff" in session_state:
        parsed_diff = session_state["parsed_diff"]
        repo_root = session_state.get("repo_root", "")
        normalized_path = file_path
        if repo_root and file_path.startswith(repo_root):
            normalized_path = os.path.relpath(file_path, repo_root)

        if normalized_path in parsed_diff:
            file_change = parsed_diff[normalized_path]
            if file_change["change_type"] == "DELETED":
                return f"File '{normalized_path}' was deleted in this change. Previous content is not available for review."

    if not os.path.exists(file_path):
        return f"Error: File '{file_path}' does not exist"

    if not os.path.isfile(file_path):
        return f"Error: Path '{file_path}' is not a file"

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    except UnicodeDecodeError:
        return f"Error: File '{file_path}' contains binary data or unsupported encoding"
    except PermissionError:
        return f"Error: Permission denied reading file '{file_path}'"
    except Exception as e:
        return f"Error reading file '{file_path}': {str(e)}"


def list_directory(directory_path: str, session_state: Dict[str, Any] = None) -> str:
    """
    List directory contents using system ls/dir command.

    Args:
        directory_path: Path to the directory to list (relative paths resolved against repo root)
        session_state: Session state containing repository context

    Returns:
        Raw command output showing directory contents with details,
        or error message if command fails
    """
    if (
        not os.path.isabs(directory_path)
        and session_state
        and "repo_root" in session_state
    ):
        directory_path = os.path.join(session_state["repo_root"], directory_path)

    if not os.path.exists(directory_path):
        return f"Error: Directory '{directory_path}' does not exist"

    if not os.path.isdir(directory_path):
        return f"Error: Path '{directory_path}' is not a directory"

    try:
        if sys.platform.startswith("win"):
            cmd = ["cmd", "/c", "dir", "/a", directory_path]
        else:
            cmd = ["ls", "-la", directory_path]

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.returncode == 0:
            return result.stdout
        else:
            return f"Error: {result.stderr.strip()}"

    except Exception as e:
        return f"Error: Failed to list directory '{directory_path}': {str(e)}"


def find_files(pattern: str, session_state: Dict[str, Any] = None) -> str:
    """Find files matching pattern using system command."""
    search_dir = "."
    if session_state and "repo_root" in session_state:
        search_dir = session_state["repo_root"]

    try:
        if sys.platform.startswith("win"):
            cmd = ["cmd", "/c", f'cd /d "{search_dir}" && dir /s /b {pattern}']
        else:
            cmd = ["find", search_dir, "-name", pattern, "-type", "f"]

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.returncode == 0:
            return result.stdout
        else:
            return f"Error: {result.stderr.strip()}"

    except Exception as e:
        return f"Error: Failed to find files with pattern '{pattern}': {str(e)}"


def search_content(query: str, session_state: Dict[str, Any] = None) -> str:
    """Search repository content using ripgrep."""
    if not _is_ripgrep_available():
        return ""
    search_dir = "."
    if session_state and "repo_root" in session_state:
        search_dir = session_state["repo_root"]

    cmd = [
        "rg",
        "--max-count",
        "30",
        "--context=3",
        "--line-number",
        "--column",
        "--ignore-case",
        "--fixed-strings",
        "--",
        query,
        search_dir,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.returncode not in [0, 1]:
            return f"Error: ripgrep failed with return code {result.returncode}: {result.stderr}"

        return result.stdout

    except Exception as e:
        return f"Error: Failed to run ripgrep: {str(e)}"


def get_git_history(
    repo_path: str = ".", head: str = "HEAD", base: str = "main"
) -> str:
    """Get git history between base and head commits."""
    if not _is_git_repo(repo_path):
        return "Error: Not a git repository"

    try:
        cmd = [
            "git",
            "log",
            "--oneline",
            "--stat",
            "--graph",
            "--decorate",
            f"{base}..{head}",
        ]

        result = subprocess.run(
            cmd, cwd=repo_path, capture_output=True, text=True, check=False
        )

        if result.returncode != 0:
            return f"Error: git command failed: {result.stderr.strip()}"

        output = result.stdout.strip()
        if not output:
            return f"No commits found in range {base}..{head}"

        return output

    except Exception as e:
        return f"Error getting git context: {str(e)}"


def _is_ripgrep_available() -> bool:
    """Check if ripgrep is available."""
    try:
        subprocess.run(["rg", "--version"], capture_output=True, check=False)
        return True
    except FileNotFoundError:
        return False


def _is_git_repo(repo_path: str) -> bool:
    """Check if path is a git repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=repo_path,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        print(e)
        return False


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read complete file content as string",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to read",
                    }
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List directory contents using system ls/dir command",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory_path": {
                        "type": "string",
                        "description": "Path to the directory to list",
                    }
                },
                "required": ["directory_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_files",
            "description": "Find files matching pattern using system find/dir command",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "minLength": 1,
                        "description": "File pattern to search for (e.g., '*.py', 'package.json')",
                    }
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_content",
            "description": "Search repository content using ripgrep. Returns matches with file paths, line numbers, and context in format: 'file:line:col:content' for matches, 'file-line-context' for context lines",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 500,
                        "description": "Search query (literal string)",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_history",
            "description": "Get git history including commit log, branch info, and change statistics",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo_path": {
                        "type": "string",
                        "default": ".",
                        "description": "Path to git repository",
                    },
                    "head": {
                        "type": "string",
                        "default": "HEAD",
                        "description": "Head commit/branch",
                    },
                    "base": {
                        "type": "string",
                        "default": "main",
                        "description": "Base commit/branch to compare against",
                    },
                },
                "required": ["repo_path", "head", "base"],
            },
        },
    },
]


def get_tool_definitions() -> List[Dict[str, Any]]:
    """Get all tool definitions for aisuite."""
    return TOOLS


def call_tool(
    tool_name: str, parameters: Dict[str, Any], session_state: Dict[str, Any] = None
) -> str:
    """Call a tool function directly."""
    if tool_name == "read_file":
        if session_state:
            result = read_file(parameters["file_path"], session_state)
        else:
            result = read_file(parameters["file_path"])
    elif tool_name == "list_directory":
        if session_state:
            result = list_directory(parameters["directory_path"], session_state)
        else:
            result = list_directory(parameters["directory_path"])
    elif tool_name == "find_files":
        if session_state:
            result = find_files(parameters["pattern"], session_state)
        else:
            result = find_files(parameters["pattern"])
    elif tool_name == "search_content":
        if session_state:
            result = search_content(parameters["query"], session_state)
        else:
            result = search_content(parameters["query"])
    elif tool_name == "git_history":
        result = get_git_history(
            parameters.get("repo_path", "."),
            parameters.get("head", "HEAD"),
            parameters.get("base", "main"),
        )
    else:
        raise ValueError(f"Unknown tool: {tool_name}")

    return str(result)
