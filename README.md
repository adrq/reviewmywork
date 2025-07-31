# ReviewMyWork - AI Code Review Agent

An intelligent code review agent that orchestrates LLM tool calls to provide comprehensive analysis of your git changes.

![ReviewMyWork Demo](demo.png)

## Installation

```bash
# Install globally with pip
pip install reviewmywork

# Install globally with uv
uv tool install reviewmywork
```

## Key Features

- **LLM Agent Architecture**: Orchestrates multiple tool calls for thorough analysis
- **Rich Terminal UI**: Structured output with confidence scores, detailed issues, and actionable suggestions  
- **Multi-Provider Support**: Works with any aisuite-compatible LLM (Anthropic, OpenAI, Azure, Ollama, etc.)
- **Minimal & Fast**: Focused on core functionality

## How It Works

ReviewMyWork parses your git diff, builds some context, and then allows the LLM to intelligently use tools like `read_file`, `search_content`, and `git_history` through multi-turn conversations to understand context and provide detailed reviews with confidence scoring.

## Configuration

Set your LLM provider credentials:

```bash
# Example for Anthropic
export ANTHROPIC_API_KEY=your-key-here

# Optional: Configure timeouts
export REVIEWMYWORK_TOOL_TIMEOUT=120
export REVIEWMYWORK_MAX_TURNS=10
```

Or use a `.env` file in your project root.

## Requirements

- Python 3.10+
- ripgrep (`rg` command)
- git
- LLM API key for your chosen provider

## Usage

```bash
# Review changes against main branch
reviewmywork review . --base main --model your-model

# Review specific repository
reviewmywork review --base develop --model openai:gpt-4.1 /path/to/repo 

# Get help
reviewmywork --help
```

**Short alias:** Use `rmw` instead of `reviewmywork` for faster typing.

## Development

### Development Setup

```bash
# Install dependencies and package
uv sync
uv pip install -e .

# Run a review
reviewmywork review . --base main --model anthropic:claude-3-5-sonnet
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
