# Copyright (c) 2025 Adrian Quiroga
# Licensed under the MIT License

import json
import time
import re
import subprocess
from typing import Dict, List, Any, Optional

import aisuite as ai
from .tools import get_tool_definitions, call_tool, parse_diff
from .schemas import ReviewOutput
import logging

logger = logging.getLogger("reviewmywork")


class ReviewOrchestrator:
    """Orchestrator for LLM-based code review."""

    def __init__(self, config: Dict[str, Any], model: str):
        self.config = config
        self.model = model

        provider_configs = {}
        provider = model.split(":")[0] if ":" in model else "unknown"
        if provider == "ollama":
            provider_configs["ollama"] = {"timeout": config["llm_timeout"]}

        self.client = ai.Client(provider_configs=provider_configs)
        self.session_state = {}
        self._system_prompt = self._create_system_prompt()

    def _create_system_prompt(self) -> str:
        """Create system prompt for code review."""
        return """You are a code review assistant. Use available tools to analyze changes, then respond with JSON:

Tools:
- read_file: Read complete file content as string
- list_directory: List directory contents using system ls/dir command
- find_files: Find files matching pattern using system find/dir command
- search_content: Search repository content using ripgrep. Returns matches with file paths, line numbers, and context in format: 'file:line:col:content' for matches, 'file-line-context' for context lines
- git_history: Get git history including commit log, branch info, and change statistics

IMPORTANT: 
- Files may be added, modified, or DELETED - check the change type provided
- DO NOT try to read deleted files with read_file - they no longer exist
- Focus your analysis on files that exist and were modified or added
- Always read the full file content to understand the context and spot potential issues
- You are encouraged to use list_directory tool to better understand project structure and explore the codebase in order to provide better reviews as needed

Required response format:
{
  "summary": "Brief overview",
  "confidence": 0.85,
  "confidence_reasoning": "Why this confidence",
  "issues": [{"type": "bug|security|performance|style", "severity": "low|medium|high|critical", "title": "Issue", "description": "Details", "file": "path", "line": 42, "confidence": 0.9, "confidence_reasoning": "Why", "suggestion": "Fix"}],
  "positive_aspects": [{"title": "Good", "description": "Why"}],
  "suggestions": [{"type": "improvement", "title": "Suggest", "description": "Details", "priority": "medium"}]
}

Focus on bugs and security issues in the actual changed code."""

    def _execute_tool(self, tool_call: Dict[str, Any]) -> str:
        """Execute a single tool call and return formatted result for LLM."""
        tool_name = tool_call["function"]["name"]
        parameters = tool_call["function"]["arguments"]

        if isinstance(parameters, str):
            try:
                parameters = json.loads(parameters)
            except json.JSONDecodeError as e:
                return f"❌ Error in {tool_name}: Invalid JSON parameters: {str(e)}"

        start_time = time.time()

        try:
            result = call_tool(tool_name, parameters, self.session_state)

            duration = time.time() - start_time
            logger.info(
                "🔧 %s: Running %s... ✓ [%.1fs]", tool_name, tool_name, duration
            )

            return f"🔧 {tool_name}:\n{str(result)}"

        except Exception as e:
            duration = time.time() - start_time
            logger.info(
                "🔧 %s: Running %s... ❌ Failed: %s [%.1fs]",
                tool_name,
                tool_name,
                str(e),
                duration,
            )
            return f"❌ Error in {tool_name}: {str(e)}"

    def _parse_json(self, response_content: str) -> Optional[ReviewOutput]:
        """Parse JSON from LLM response."""
        try:
            content = response_content.strip()

            if "```json" in content:
                start = content.find("```json") + 7
                end = content.find("```", start)
                if end != -1:
                    content = content[start:end].strip()
            elif "```" in content:
                start = content.find("```") + 3
                end = content.find("```", start)
                if end != -1:
                    content = content[start:end].strip()

            if not content.startswith("{"):
                json_start = content.find("{")
                if json_start != -1:
                    json_end = content.rfind("}")
                    if json_end != -1:
                        content = content[json_start : json_end + 1]

            parsed = json.loads(content)
            return ReviewOutput(**parsed)
        except Exception as e:
            logger.info(f"JSON parsing failed: {e}")
            logger.info(f"Raw response: {response_content[:200]}...")
            return None

    def _make_llm_call(self, messages: List[Dict[str, Any]]) -> Any:
        """Make LLM call with rate limit retry."""
        for attempt in range(3):
            try:
                return self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=get_tool_definitions(),
                    tool_choice="auto",
                    temperature=0.1,
                    max_tokens=4000,
                )
            except Exception as e:
                if "429" in str(e) and attempt < 2:
                    delay = 60
                    if "Retry-After:" in str(e):
                        try:
                            match = re.search(r"Retry-After:\s*(\d+)", str(e))
                            if match:
                                delay = int(match.group(1))
                        except Exception as e:
                            logger.debug(e)
                            pass

                    logger.info(f"⏳ Rate limited, retrying in {delay}s...")
                    time.sleep(delay)
                    continue
                raise

    def _create_context(self, diff_content: str) -> str:
        """Create complete LLM context from diff and git information."""
        try:
            file_changes = parse_diff(diff_content)
            self.session_state["parsed_diff"] = {fc["file"]: fc for fc in file_changes}
            self.session_state["raw_diff"] = diff_content

            repo_root = self.session_state.get("repo_root", ".")
            git_context = ""

            try:
                base_info_cmd = ["git", "show", "--oneline", "--no-patch", "HEAD"]
                base_result = subprocess.run(
                    base_info_cmd,
                    cwd=repo_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                base_info = (
                    base_result.stdout.strip()
                    if base_result.returncode == 0
                    else "Unknown base"
                )

                status_cmd = ["git", "status", "--porcelain", "--branch"]
                status_result = subprocess.run(
                    status_cmd,
                    cwd=repo_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                status_output = (
                    status_result.stdout.strip()
                    if status_result.returncode == 0
                    else ""
                )

                git_context = f"""## Git Context

**Current HEAD:** {base_info}
**Working Directory Status:**
{status_output if status_output else "Clean working directory"}
"""
            except Exception as e:
                logger.info(f"Could not get git context: {e}")

            file_list = []
            for fc in file_changes:
                file_list.append(f"- {fc['file']} ({fc['change_type']})")

            files_context = "\n".join(file_list)

            return f"""{git_context}

## Changed Files
Found {len(file_changes)} changed files:

{files_context}

## Raw Diff
```diff
{diff_content}
```

Use read_file to examine the full content of modified or added files. Do not try to read DELETED files."""
        except Exception as e:
            self.session_state["raw_diff"] = diff_content
            return f"Diff parsing failed: {e}. Use `read_file` for analysis along with raw diff {diff_content}"

    def review_changes(self, diff_content: str) -> Dict[str, Any]:
        """Main method to review code changes using LLM with tool calling."""
        _ = time.time()

        diff_context = self._create_context(diff_content)

        initial_message = f"{diff_context}\n\nAnalyze the changes and provide a code review in JSON format."

        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": initial_message},
        ]

        for turn in range(1, self.config["max_turns"] + 1):
            try:
                response = self._make_llm_call(messages)
                message = response.choices[0].message

                if message.tool_calls:
                    messages.append(
                        {
                            "role": "assistant",
                            "content": message.content,
                            "tool_calls": [
                                {
                                    "id": tc.id,
                                    "type": tc.type,
                                    "function": {
                                        "name": tc.function.name,
                                        "arguments": tc.function.arguments,
                                    },
                                }
                                for tc in message.tool_calls
                            ],
                        }
                    )

                    for tool_call in message.tool_calls:
                        result = self._execute_tool(
                            {
                                "function": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments,
                                }
                            }
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": result,
                            }
                        )

                    logger.info("📊 Turn %d/%d", turn, self.config["max_turns"])
                    continue

                review = self._parse_json(message.content or "")
                if review:
                    return {"success": True, "review": review.model_dump()}
                else:
                    return {
                        "success": False,
                        "error": "Invalid JSON response",
                        "raw_response": message.content,
                    }

            except Exception as e:
                return {"success": False, "error": f"Error on turn {turn}: {str(e)}"}

        return {
            "success": False,
            "error": f"Reached max turns ({self.config['max_turns']})",
        }
