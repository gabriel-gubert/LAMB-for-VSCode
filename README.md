# LLM-Assisted Code Migration Bot (LAMB) Toolsuite for Visual Studio Code

The **LAMB Toolsuite for Visual Studio Code** brings the power of **LAMB** (**L**LM-**A**ssisted **C**ode **M**igration **B**ot) directly into your editor. By combining deterministic code analysis with specialized LLM agent workflows, LAMB creates verified API mapping tables and migrates legacy code to modern API standards safely and deterministically without hallucination.

---

## Features

* **Interactive Mapping Table Generator:** Generate and manage version-to-version API mapping tables using a dedicated webview panel.
* **Inline Code Migration:** Migrate entire files or specific code selections using stored mapping tables.
* **Code Highlighting & Severity Annotation:** Annotate source code snippets with severity flags (`Critical`, `Warning`, `Info`, `Don't Touch`) to guide the LLM during code migrations.
* **Interactive Side-by-Side Migration Review:** Review migrated code via VS Code's diff viewer with confidence scores, diagnostic metrics, and applied mapping rules highlighted directly in the gutter.
* **Automatic Python Virtual Environment Management:** Self-contained setup that packages and bootstraps the internal `lamb` Python engine into `~/.lamb/venv`.
* **Settings Synchronization:** Seamlessly synchronizes VS Code extension settings to `~/.lamb/config.toml`.

---

## Architecture Overview

The extension acts as a frontend interface for the underlying Python-based `lamb` engine:

```
┌──────────────────────────────────────────────────────────┐
│                   VS Code Extension                      │
│                                                          │
│  ┌────────────────────┐      ┌────────────────────────┐  │
│  │   Activity Bar /   │      │ Editor Context Menus / │  │
│  │   Webview Panel    │      │  Title Bar Actions     │  │
│  └─────────┬──────────┘      └───────────┬────────────┘  │
└────────────┼─────────────────────────────┼───────────────┘
             │                             │
             ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│              CLI Runner (cliRunner.js)                   │
│                                                          │
│     Executes commands via Python virtual environment     │
│     (~/.lamb/venv/bin/lamb)                              │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│              Internal Core LAMB Engine                   │
│                                                          │
│  ┌────────────────────┐      ┌────────────────────────┐  │
│  │  `lamb map`        │      │  `lamb migrate`        │  │
│  │  Multi-Agent Engine│      │  Code Generation       │  │
│  └────────────────────┘      └────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

```

---

## Prerequisites

* **Visual Studio Code:** `v1.80.0` or higher.
* **Python:** Python 3 installed on the host system (used to initialize `~/.lamb/venv`).

---

## Getting Started

### 1. Installation

1. Open Visual Studio Code.
2. Install the extension using the packaged `.vsix` file or by opening the source code folder in VS Code.
3. Upon activation, the extension automatically extracts the bundled `lamb` wheel package from `vendor/` and sets up an isolated Python virtual environment at `~/.lamb/venv`.

### 2. Generating a Mapping Table

1. Click on the **LAMB Toolsuite** icon in the VS Code Activity Bar.
2. In the **Generate Mapping Table** webview view:
  * Select the **Source Version Root (Path V1)** directory containing legacy API documentation/code.
  * Select the **Target Version Root (Path V2)** directory containing current API documentation/code.
  * Enter a unique **Mapping Table Alias** (e.g., `SynthNetLib`).
  * (Optional) Configure output paths, **LangGraph Thread ID** (to resume a prior mapping run), checkpoint database locations, or execution overrides like Multi-Agent Consensus and batch sizes.
3. Click **Generate Mapping Table** (or **Cancel Mapping Process** to abort a running generation task).

---

## Usage & Workflows

### Annotating Code with Severity Highlights

Before running a migration, you can mark specific lines or blocks of code with custom severity levels to influence how the migration agent handles them:

1. Select a block of code in any editor window.
2. Right-click and choose **Highlight with LAMB...** (or run `lamb-toolsuite.addHighlight` from the Command Palette).
3. Select a severity level:
  * **Red (Critical Severity / Highest Priority):** Forces highest priority re-mapping.
  * **Yellow (Warning Severity / Medium Priority):** Standard focus area.
  * **Green (Info Focus / Above-Normal Priority):** Informational context.
  * **Blue (Don't Touch):** Instructs the engine to leave the code block unmodified.

Note: You can remove a highlight by clicking the **Delete LAMB Highlight** CodeLens above the snippet or selecting **Clear LAMB Highlights...** from the context menu.

---

### Migrating Source Code

1. Open the file you wish to migrate.
2. (Optional) Select a specific code snippet if you only want to migrate part of the file.
3. Click the **Migrate with LAMB...** button in the editor title bar or right-click and choose **Migrate with LAMB...**.
4. Select the registered **Mapping Table Alias** you want to apply.
5. If a snippet is selected, choose the migration scope:
  * **Migrate Selected Snippet Only**
  * **Migrate Full File (With Multi-Highlight Awareness)**
6. Provide any optional user instructions or comments when prompted.
7. A side-by-side Diff Preview editor will open:
  * Green, yellow, and red gutter markers in the preview display rule confidence levels.
  * Hover over gutter indicators to view rule details, matched targets, logprob scores, and diagnostics.
8. Click the **Accept Migration Changes** checkmark (`✓`) in the editor title bar to apply changes to the source file, or the **Discard Migration Changes** cross (`✗`) to cancel.

---

## Extension Commands

| Command Title | Identifier | Description |
| --- | --- | --- |
| **Migrate with LAMB...** | `lamb-toolsuite.migrate` | Initiates the code migration workflow for the active editor. |
| **Highlight with LAMB...** | `lamb-toolsuite.addHighlight` | Annotates the current selection with a severity highlight. |
| **Clear LAMB Highlights...** | `lamb-toolsuite.clearHighlights` | Removes all severity highlights from the current editor. |
| **Accept Migration Changes** | `lamb-toolsuite.acceptMigration` | Applies the generated diff migration changes to the file. |
| **Discard Migration Changes** | `lamb-toolsuite.discardMigration` | Rejects the migration changes and closes the diff view. |

---

## Extension Settings

All extension settings automatically synchronize to `~/.lamb/config.toml` upon modification.

### General & LiteLLM Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lamb.general.verbose` | `boolean` | `false` | Enable verbose logging output. |
| `lamb.general.litellm.enabled` | `boolean` | `false` | Enable LiteLLM Proxy Server integration. |
| `lamb.general.litellm.host` | `string` | `"127.0.0.1"` | Host IP address for LiteLLM Proxy. |
| `lamb.general.litellm.port` | `integer` | `4000` | Port for LiteLLM Proxy. |
| `lamb.general.litellm.configFile` | `string` | `""` | Path to LiteLLM Proxy YAML configuration file. |

### Default Agent Parameters

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lamb.tasks.default` | `object` | `{"model": "Qwen/Qwen3-30B-A3B-Instruct-2507", "base_url": "http://127.0.0.1:1234/v1"}` | Fallback LLM agent initialization parameters (LangChain's `ChatOpenAI` parameters + `requests_per_minute` and `tokens_per_minute`). |

### Mapping Engine Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lamb.tasks.mapping.multiAgent` | `boolean` | `false` | Enable multi-agent consensus resolution. |
| `lamb.tasks.mapping.discoveryBatchSize` | `integer` | `20` | Batch size for Discovery Agent execution. |
| `lamb.tasks.mapping.resolverBatchSize` | `integer` | `20` | Batch size for Resolver Agent execution. |
| `lamb.tasks.mapping.checkpointDatabasePath` | `string` | `"~/.lamb/map_checkpoint.db"` | SQLite 3 database path for LangGraph checkpoints. |
| `lamb.tasks.mapping.stageOutputDir` | `string` | `""` | Output directory for stage JSON files. |
| `lamb.tasks.mapping.tmpDir` | `string` | `"~/.lamb/tmp"` | Path to temporary directory. |
| `lamb.tasks.mapping.embedding` | `object` | `{"model": "Qwen/Qwen3-Embedding-8B", "base_url": "http://127.0.0.1:1234/v1"}` | Vector embedding agent parameters. |
| `lamb.tasks.mapping.discovery` | `object` | `{}` | Dynamic initialization parameters for Discovery Agent. |
| `lamb.tasks.mapping.extraction` | `object` | `{}` | Dynamic initialization parameters for Extraction Agent. |
| `lamb.tasks.mapping.generalResolution` | `object` | `{}` | Dynamic initialization parameters for General Resolution Consensus Agent. |
| `lamb.tasks.mapping.lexicalResolution` | `object` | `{}` | Dynamic initialization parameters for Lexical Resolution Consensus Agent. |
| `lamb.tasks.mapping.semanticResolution` | `object` | `{}` | Dynamic initialization parameters for Semantic Resolution Consensus Agent. |

### Migration Engine Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lamb.tasks.migration.summarizationThreshold` | `integer` | `2000` | Token threshold to trigger documentation summarization. |
| `lamb.tasks.migration.maxAttempts` | `integer` | `3` | Maximum migration retries allowed. |
| `lamb.tasks.migration.logprobs` | `boolean` | `true` | Enable logprobs for confidence score calculation. |
| `lamb.tasks.migration.detection` | `object` | `{}` | Dynamic initialization parameters for Programming Language Detection Agent. |
| `lamb.tasks.migration.migration` | `object` | `{}` | Dynamic initialization parameters for Primary Migration Agent. |
| `lamb.tasks.migration.summarization` | `object` | `{}` | Dynamic initialization parameters for Summarization Agent. |

### LiteLLM Agent Routing Overrides

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lamb.general.litellm.agents.default` | `boolean` | `false` | Enable LiteLLM Proxy for the Default Fallback Agent. |
| `lamb.general.litellm.agents.mapping.discovery` | `boolean` | `false` | Enable LiteLLM Proxy for the Discovery Agent. |
| `lamb.general.litellm.agents.mapping.embedding` | `boolean` | `false` | Enable LiteLLM Proxy for the Embedding Agent. |
| `lamb.general.litellm.agents.mapping.extraction` | `boolean` | `false` | Enable LiteLLM Proxy for the Extraction Agent. |
| `lamb.general.litellm.agents.mapping.generalResolution` | `boolean` | `false` | Enable LiteLLM Proxy for the General Resolution Agent. |
| `lamb.general.litellm.agents.mapping.lexicalResolution` | `boolean` | `false` | Enable LiteLLM Proxy for the Lexical Resolution Agent. |
| `lamb.general.litellm.agents.mapping.semanticResolution` | `boolean` | `false` | Enable LiteLLM Proxy for the Semantic Resolution Agent. |
| `lamb.general.litellm.agents.migration.detection` | `boolean` | `false` | Enable LiteLLM Proxy for the Language Detection Agent. |
| `lamb.general.litellm.agents.migration.migration` | `boolean` | `false` | Enable LiteLLM Proxy for the Migration Agent. |
| `lamb.general.litellm.agents.migration.summarization` | `boolean` | `false` | Enable LiteLLM Proxy for the Summarization Agent. |

---

## License

This project is licensed under the Apache License 2.0.

---

## Citation

If you use **LAMB** or this extension in your research, please cite the following paper:

```bibtex
@inproceedings{Gubert2026,
  author    = {Gubert, Gabriel Vitor Klaumann and Kugele, Stefan and Georges, Munir},
  title     = {A Hybrid LLM-Guided Approach to Code Migration Using API-Derived Rules},
  booktitle = {2026 IEEE/ACM Third International Conference on AI Foundation Models and Software Engineering (FORGE '26)},
  year      = {2026},
  pages     = {5},
  location  = {Rio de Janeiro, Brazil},
  publisher = {ACM},
  address   = {New York, NY, USA},
  doi       = {10.1145/3793655.3793734},
  url       = {https://doi.org/10.1145/3793655.3793734}
}

```