# Copyright (c) 2025 Adrian Quiroga
# Licensed under the MIT License

import os
from typing import Dict, Any
from pathlib import Path
import logging

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.tree import Tree
from git import Repo, InvalidGitRepositoryError
from dotenv import load_dotenv

from .reviewer import ReviewOrchestrator

app = typer.Typer(
    name="reviewmywork",
    help="AI Code Review Agent - Analyze git diffs with LLM-powered insights",
    add_completion=False,
    rich_markup_mode="rich",
)
console = Console()

VERSION = "0.1.1"


def load_env_config() -> Dict[str, Any]:
    """Load configuration from environment variables."""
    env_file = Path(".env")
    if env_file.exists():
        load_dotenv(env_file)

    env_local_file = Path(".env.local")
    if env_local_file.exists():
        load_dotenv(env_local_file, override=True)

    return {
        "tool_timeout": int(os.getenv("REVIEWMYWORK_TOOL_TIMEOUT", "120")),
        "max_turns": int(os.getenv("REVIEWMYWORK_MAX_TURNS", "10")),
        "llm_timeout": int(os.getenv("REVIEWMYWORK_LLM_TIMEOUT", "180")),
    }


def _create_issues_table(issues: list) -> Table:
    """Create Rich table for displaying issues."""
    issues_panel = Table(
        title="🚨 Issues Found", show_header=True, header_style="bold red"
    )
    issues_panel.add_column("Type", style="yellow", min_width=8)
    issues_panel.add_column("Severity", style="red", min_width=8)
    issues_panel.add_column("Location", style="cyan", min_width=12)
    issues_panel.add_column("Issue", style="white", min_width=30)
    issues_panel.add_column("Confidence", style="dim", min_width=8)

    for issue in issues:
        location = f"{issue['file']}"
        if issue.get("line"):
            location += f":{issue['line']}"

        issues_panel.add_row(
            issue["type"].title(),
            issue["severity"].upper(),
            location,
            f"[bold]{issue['title']}[/bold]\n{issue['description']}\n[green]💡 {issue['suggestion']}[/green]",
            f"{issue['confidence']:.1%}",
        )

    return issues_panel


def _create_tree_section(items: list, title: str, color: str) -> Tree:
    """Create Rich tree for displaying lists of items."""
    tree = Tree(title)

    for item in items:
        if "priority" in item:  # suggestions
            priority_color = {"high": "red", "medium": "yellow", "low": "dim"}.get(
                item["priority"], "white"
            )
            tree.add(
                f"[{priority_color}]{item['title']}[/{priority_color}] "
                f"[dim]({item['type']}, {item['priority']} priority)[/dim]\n"
                f"{item['description']}"
            )
        else:  # positive aspects
            tree.add(f"[{color}]{item['title']}[/{color}]: {item['description']}")

    return tree


def display_review_results(result: Dict[str, Any]) -> None:
    """Display review results in a rich formatted output."""
    if not result["success"]:
        console.print(
            Panel(
                f"[red]Review Failed:[/red] {result['error']}",
                title="❌ Error",
                border_style="red",
            )
        )
        return

    review = result["review"]

    console.print(
        Panel(
            f"[bold]{review['summary']}[/bold]\n\n"
            f"[dim]Confidence: {review['confidence']:.1%}[/dim]\n"
            f"[dim]{review['confidence_reasoning']}[/dim]",
            title="📋 Review Summary",
            border_style="blue",
        )
    )

    if review["issues"]:
        console.print("\n")
        console.print(_create_issues_table(review["issues"]))

    if review["positive_aspects"]:
        console.print("\n")
        console.print(_create_tree_section(review["positive_aspects"], "✅", "green"))

    if review["suggestions"]:
        console.print("\n")
        console.print(_create_tree_section(review["suggestions"], "💡", "yellow"))


@app.command()
def review(
    repo_path: str = typer.Argument(
        ".", help="Path to the git repository (default: current directory)"
    ),
    base: str = typer.Option(
        ...,
        "--base",
        "-b",
        help="Base branch/commit to compare against your working directory",
    ),
    model: str = typer.Option(
        ...,
        "--model",
        "-m",
        help="Model in aisuite format (e.g., 'openai:gpt-4o', 'anthropic:claude-3-5-sonnet-20241022')",
    ),
):
    """Compare your current working directory (including uncommitted changes) against a base commit/branch."""

    logging.basicConfig(
        level=logging.INFO, format="%(message)s", handlers=[logging.StreamHandler()]
    )
    logger = logging.getLogger("reviewmywork")

    try:
        config = load_env_config()
        logger.info(f"🚀 ReviewMyWork v{VERSION} • %s", model)

    except Exception as e:
        console.print(f"[red]Configuration error: {str(e)}[/red]")
        raise typer.Exit(1)

    try:
        repo = Repo(repo_path)
        if repo.bare:
            console.print(f"[red]Error: {repo_path} is a bare repository[/red]")
            raise typer.Exit(1)
    except InvalidGitRepositoryError:
        console.print(f"[red]Error: {repo_path} is not a git repository[/red]")
        raise typer.Exit(1)

    logger.info("🔍 Analyzing changes from %s to working directory", base)

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            diff_task = progress.add_task("Getting git diff...", total=None)
            diff_content = repo.git.diff(base, unified=3)
            progress.remove_task(diff_task)

            if not diff_content.strip():
                console.print(
                    f"[yellow]No changes found in working directory compared to {base}. Nothing to review.[/yellow]"
                )
                raise typer.Exit(0)

            _ = progress.add_task("Performing AI code review...", total=None)
            orchestrator = ReviewOrchestrator(config, model)
            orchestrator.session_state["repo_root"] = repo.working_dir
            result = orchestrator.review_changes(diff_content)

    except typer.Exit:
        raise
    except Exception as e:
        error_msg = (
            f"Failed to get git diff: {str(e)}"
            if "diff" in str(e).lower()
            else f"Review error: {str(e)}"
        )
        console.print(f"[red]{error_msg}[/red]")
        raise typer.Exit(1)

    display_review_results(result)


@app.command()
def version():
    """Show version information."""
    console.print(
        Panel(
            f"[bold blue]ReviewMyWork[/bold blue] - AI Code Review Agent\n\n"
            f"[dim]Version: {VERSION}[/dim]\n"
            f"[dim]A sophisticated code review agent powered by LLMs[/dim]",
            title="ℹ️ Version",
            border_style="blue",
        )
    )


def main():
    """Entry point for the CLI application."""
    app()


if __name__ == "__main__":
    main()
