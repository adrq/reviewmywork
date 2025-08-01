# Copyright (c) 2025 Adrian Quiroga
# Licensed under the MIT License

from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class ReviewIssue(BaseModel):
    """Code review issue."""

    type: Literal[
        "bug", "security", "performance", "style", "maintainability", "testing"
    ]
    severity: Literal["critical", "high", "medium", "low"]
    title: str = Field(max_length=100, description="Short description of the issue")
    description: str = Field(description="Detailed explanation of the issue")
    file: str = Field(description="File path where issue is located")
    line: Optional[int] = Field(default=None, description="Line number (if applicable)")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score (0.0-1.0)")
    confidence_reasoning: str = Field(description="Explanation for confidence score")
    suggestion: str = Field(description="Recommended fix or improvement")


class ReviewPositiveAspect(BaseModel):
    """Positive aspect in code review."""

    title: str = Field(max_length=100, description="What was done well")
    description: str = Field(description="Explanation of the good practice")


class ReviewSuggestion(BaseModel):
    """Code improvement suggestion."""

    type: Literal["improvement", "refactor", "testing", "documentation"]
    title: str = Field(max_length=100, description="Enhancement suggestion")
    description: str = Field(description="How to improve the code")
    priority: Literal["high", "medium", "low"] = Field(description="Priority level")


class ReviewOutput(BaseModel):
    """Code review output."""

    summary: str = Field(description="Overall assessment of changes")
    confidence: float = Field(
        ge=0.0, le=1.0, description="Overall confidence in review"
    )
    confidence_reasoning: str = Field(description="Explanation for overall confidence")
    issues: List[ReviewIssue] = Field(description="Issues identified in the code")
    positive_aspects: List[ReviewPositiveAspect] = Field(
        description="Positive aspects noted"
    )
    suggestions: List[ReviewSuggestion] = Field(
        description="Suggestions for improvement"
    )
