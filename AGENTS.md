# Repository Guidelines

## Project Structure & Module Organization

This directory is currently empty and has no Git metadata, source code, tests, or assets. No application framework or language has been selected. Update this guide as the project takes shape.

When adding the initial implementation, establish a clear layout, such as `src/` for application code, `tests/` for tests, and `assets/` for static resources. These are suggested directories, not existing paths. Keep related modules together and document the chosen structure in `README.md`.

## Build, Test, and Development Commands

No build, test, or development commands are configured yet. Do not assume commands such as `npm test` or `npm run build` are available.

When introducing tooling, document prerequisites, dependency installation, local startup, production builds, and test commands in `README.md`. Commit the appropriate dependency manifest and lockfile so contributors can reproduce the environment.

## Coding Style & Naming Conventions

No formatter, linter, or indentation standard is configured. When selecting a language or framework, add its formatting and linting configuration and document how to run it.

Use descriptive names, consistent indentation within each file, and the selected language's standard naming conventions. Keep changes focused and avoid unrelated formatting edits.

## Testing Guidelines

No testing framework or coverage threshold exists. Add suitable automated tests with the first executable features. Cover expected behavior, failure paths, and relevant edge cases. Use descriptive test names and follow the chosen framework's file naming convention. Document the exact test command when the framework is introduced.

## Commit & Pull Request Guidelines

No Git history is available to establish commit conventions. Until a convention is adopted, use concise, imperative subjects, such as `Add canvas initialization`.

Pull requests should explain the change, link related issues when applicable, and state what validation was performed. Include screenshots for visible interface changes and identify any setup steps or limitations.

## Security & Configuration

Keep credentials and local configuration out of version control. Provide placeholder values in example configuration files and document required environment variables when configuration is introduced.
