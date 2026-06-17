# AI Code Reviewer

A VS Code extension that performs automated code review using a 9-agent multi-provider AI pipeline with RAG (Retrieval-Augmented Generation).

## Features

- **9 specialized agents**: Security, Quality, Error Handling, Style, Complexity, Duplication, Documentation, Tests, Dependencies
- **Multi-provider**: Groq, Gemini, NVIDIA NIM, Cerebras, OpenRouter — with automatic fallback
- **RAG pipeline**: Vector store (LanceDB) for pattern matching and history-aware reviews
- **Two Agents Debate**: Opposing LLM agents argue grey-zone scores (4–7)
- **Diff-Aware Re-Review**: Compares each review against the previous snapshot
- **Multi-language**: TypeScript, JavaScript, Python, Java, Go
- **Quiet Save**: `Ctrl+Shift+S` saves without triggering a review

## Requirements

Configure your API keys in VS Code settings (`Ctrl+,` → search "AI Reviewer"):

| Setting | Provider | Purpose |
|---|---|---|
| `aiReviewer.groqApiKey` | Groq | Security agent |
| `aiReviewer.geminiApiKey` | Google Gemini | Quality agent |
| `aiReviewer.nvidiaApiKey` | NVIDIA NIM | Error, Style, Complexity, Docs, Tests |
| `aiReviewer.cerebrasApiKey` | Cerebras | Debate agent |
| `aiReviewer.openrouterApiKey` | OpenRouter | Debate + embeddings fallback |
| `aiReviewer.githubToken` | GitHub | PR context integration |

## Usage

1. Open a TypeScript, JavaScript, Python, Java, or Go file
2. Save the file — the review panel opens automatically
3. Or run **AI Reviewer: Analyze Current File** from the Command Palette

## Supported Languages

- TypeScript / JavaScript / TSX / JSX
- Python 3
- Java
- Go

## PFE Project

Developed as a Final Year Project (PFE) at ESPRIT — Mohamed Farouk BOUABID.
