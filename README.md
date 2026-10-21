# JavaLens

**See how your Java code executes.**

JavaLens is a desktop application for writing Java code and visualizing its runtime execution. Explore variables, scopes, objects, heap state, function calls, and data structures through step-by-step execution snapshots.

**[Download the latest release](https://github.com/ronaldorick2007-design/JavaLens/releases/latest)** · **[Report a bug](https://github.com/ronaldorick2007-design/JavaLens/issues)**

<img width="1920" height="1080" alt="Screenshot From 2026-10-19 16-48-25" src="https://github.com/user-attachments/assets/bccf6007-7acf-4fee-a074-0f44fb68d4e4" />

## Features

- **Java code editor** — Tabs, line numbers, and Java syntax highlighting.
- **JavaVisual** — Step through execution snapshots and follow your program's state.
- **Data structure visualization** — Array, Linear, Tree, and Graph views.
- **Variable scopes** — Inspect variables and track changes during execution.
- **Current-line tracking** — Follow the executing line as you step through a program.
- **Integrated terminal** — Use a persistent shell inside the application.
- **Light and dark themes** — Choose the appearance you prefer.
- **Simple workspace** — Start with an empty editor, then open an existing Java file or create a new one.

## Download and installation

1. Open the [latest JavaLens release](https://github.com/ronaldorick2007-design/JavaLens/releases/latest).
2. Download the installer or package for your operating system.
3. Install or launch JavaLens using the instructions for that package.
4. Install a compatible JDK if you want to use JavaVisual.

Available packages depend on the published release. Check the release assets for the supported Windows, macOS, and Linux builds.

## Usage

1. **Open or create a file:** Use `Ctrl+O` to open a Java file or `Ctrl+N` to create a new file.
2. **Write your code:** Edit the program in the code editor.
3. **Save your file:** Use `Ctrl+S` or `Ctrl+Shift+S` for Save As.
4. **Run the visualizer:** Click **Visual** to compile and run the saved Java file.
5. **Explore execution:** Step through or play the available snapshots and inspect the visualizations.
6. **Track execution:** Follow the highlighted source line and examine the program state as execution progresses.

### Requirements for JavaVisual

JavaVisual requires a saved `.java` file and a compatible JDK. The `java` and `javac` commands must be available on your `PATH`, and the JDK must include the Java Debug Interface module (`jdk.jdi`).

## Built with

- **React** — User interface
- **Rust** — Backend functionality
- **Tauri** — Desktop application framework
- **Java JDI** — Java execution inspection
- **xterm.js** — Integrated terminal interface

## Build from source

### Prerequisites

- [Node.js](https://nodejs.org/) — LTS recommended
- [Rust](https://rustup.rs/) — Stable toolchain
- [JDK](https://adoptium.net/) — Required for JavaVisual development and testing
- [Tauri system dependencies](https://tauri.app/start/prerequisites/) — Required for your operating system

### Setup

Clone the repository:

```bash
git clone https://github.com/ronaldorick2007-design/JavaLens.git
cd JavaLens
```

Install dependencies:

```bash
npm install
```

Start the development application:

```bash
npm run tauri dev
```

### Build a release

```bash
npm run tauri build
```

Tauri's generated bundles and binaries are typically written under:

```text
src-tauri/target/release/bundle/
```

## Project structure

```text
src/
  App.jsx             Main layout, tabs, file operations
  Editor.jsx          Java code editor
  Terminal.jsx        Integrated terminal
  JavaVisual.jsx      Runtime visualization interface
  ThemeProvider.jsx   Theme management

src-tauri/
  Rust backend        Terminal sessions and Java execution
```

The exact file structure may evolve as the project develops.

## Known limitations

- JavaVisual requires a saved `.java` file.
- Syntax highlighting currently focuses on Java.
- Available terminal shells depend on the operating system.
- Visualization depends on the runtime snapshot format produced by the backend.

## Contributing

Contributions, bug reports, and feature suggestions are welcome.

Before making significant changes, especially to `JavaVisual.jsx` or the backend snapshot format, please [open an issue](https://github.com/ronaldorick2007-design/JavaLens/issues) to discuss the proposed change.

For pull requests:

- Keep changes focused.
- Explain what changed and why.
- Test your changes on at least one operating system.
- Describe the tests you performed and any known limitations.

## License

See the [`LICENSE`](LICENSE) file for the project's licensing terms.

---

JavaLens is an ongoing open-source project. Feedback, suggestions, and contributions are appreciated.
