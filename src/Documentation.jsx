import { useState } from "react";

const sections = [
  {
    title: "1. What is JavaVisual?",
    content: (
      <>
        <p>JavaVisual is a code execution visualizer that helps you understand how a program runs by showing its execution state and data structures. It supports <b>C++</b>, <b>Python</b>, and <b>Java</b>.</p>
        <p>You do not need to select a language. JavaVisual detects the language automatically.</p>
        <p>Use the visualizer to follow variable values, inspect objects, and understand how data structures are connected as your program executes.</p>
      </>
    ),
  },
  {
    title: "2. Getting Started",
    content: (
      <>
        <ol>
          <li>Open an existing source file or create a new file in the editor.</li>
          <li>Write or paste your program and save it.</li>
          <li>For a C++ program, include <code>#include "memtrack.h"</code> in your source file so JavaVisual can track memory allocation events.</li>
          <li>Click <b>Run</b>. JavaVisual executes the program and generates snapshots.</li>
          <li>Click <b>Open Visual</b> to inspect the execution snapshots and data structures.</li>
          <li>Click <b>Close Visual</b> to return to the code editor.</li>
        </ol>
        <p>No language selection or manual snapshot setup is required.</p>
        <Code>{`#include "memtrack.h" // Required for C++ memory tracking

#include <iostream>
using namespace std;

int main() {
    int values[] = {10, 20, 30};

    for (int i = 0; i < 3; i++) {
        values[i] += 5;
        point(values, i, "red");
    }

    return 0;
}`}</Code>
      </>
    ),
  },
  {
    title: "3. Understanding the Visualizer",
    content: (
      <>
        <p>After clicking <b>Open Visual</b>, use the visualizer to inspect the program's execution state.</p>
        <ul>
          <li><b>Execution position:</b> Follow the current point of execution in your source code.</li>
          <li><b>Scopes:</b> Inspect variables and their current values.</li>
          <li><b>Heap:</b> Explore objects and dynamically allocated data.</li>
          <li><b>Visual Graph:</b> Understand relationships and connections between data structures.</li>
        </ul>
        <p>Step through the generated snapshots to see how values and structures change during execution.</p>
      </>
    ),
  },
  {
    title: "4. Supported Data Structures",
    content: (
      <>
        <p>JavaVisual can display common values and data structures, including:</p>
        <ul>
          <li><b>Variables and primitive values:</b> integers, floating-point values, characters, booleans, and other variables.</li>
          <li><b>One-dimensional arrays:</b> elements arranged in a sequence.</li>
          <li><b>Two-dimensional arrays and matrices:</b> values arranged in rows and columns.</li>
          <li><b>Objects and nested objects:</b> object fields and references to other objects.</li>
          <li><b>Linked lists:</b> nodes and the links between them.</li>
          <li><b>Trees:</b> parent-child relationships between nodes.</li>
          <li><b>Graphs:</b> vertices and their connections.</li>
        </ul>
        <p>Multidimensional array visualization is limited to two dimensions.</p>
      </>
    ),
  },
  {
    title: "5. Using point() (Optional)",
    content: (
      <>
        <p>
          <code>point()</code> is an optional highlighting feature in JavaVisual.
          It allows you to highlight a specific object, variable, array element,
          or matrix element using a chosen color. The highlight helps you identify
          important data in the visualizer during program execution.
        </p>

        <p><b>How point() works in each language</b></p>

        <table>
          <thead>
            <tr>
              <th>Usage</th>
              <th>Java</th>
              <th>Python</th>
              <th>C++</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Object / Variable</td>
              <td><code>point(node, "red");</code></td>
              <td><code>point(node, "red")</code></td>
              <td><code>point(&amp;node, "red");</code></td>
            </tr>
            <tr>
              <td>Array Element</td>
              <td><code>point(arr, 2, "blue");</code></td>
              <td><code>point(arr, 2, "blue")</code></td>
              <td><code>point(&amp;arr[2], "blue");</code></td>
            </tr>
            <tr>
              <td>Matrix Element</td>
              <td><code>point(matrix, 1, 2, "green");</code></td>
              <td><code>point(matrix, 1, 2, "green")</code></td>
              <td><code>point(&amp;matrix[1][2], "green");</code></td>
            </tr>
          </tbody>
        </table>

        <p><b>Language-specific notes</b></p>

        <ul>
          <li>
            <b>Java:</b> JavaVisual automatically injects the required
            <code>point()</code> method signatures through its watcher.
            You do not need to declare or implement them. Simply use
            <code>point()</code> directly in your program.
          </li>
          <li>
            <b>Python:</b> The watcher handles <code>point()</code>
            automatically. No function definition is required.
          </li>
          <li>
            <b>C++:</b> Use the address operator <code>&amp;</code> to pass
            the address of the variable, object, or specific array element.
            The watcher handles the highlighting.
          </li>
        </ul>

        <p>
          <b>Supported colors:</b> <code>red</code>, <code>green</code>,
          <code>blue</code>, <code>purple</code>, and <code>orange</code>.
          Array and matrix indices start from <code>0</code>.
        </p>

        <p>
          <b>Note:</b> <code>point()</code> is optional. You can run and
          visualize programs without using it.
        </p>
      </>
    ),
  },
  {
    title: "6. Troubleshooting",
    content: (
      <>
        <ul>
          <li><b>Snapshots are not generated:</b> Check that your program runs successfully, then click <b>Run</b> again.</li>
          <li><b>C++ memory information is missing:</b> Make sure <code>#include "memtrack.h"</code> is present in your C++ source file.</li>
          <li><b>Visualizer does not open:</b> Run the program first so snapshots are generated, then click <b>Open Visual</b>.</li>
          <li><b>A data structure is not displayed as expected:</b> Check that the structure is initialized and that your program reaches the relevant code.</li>
          <li><b>Highlight does not appear:</b> Check the object or array reference, index values, and color spelling in the <code>point()</code> call.</li>
        </ul>
      </>
    ),
  },
  {
    title: "7. Feedback & Suggestions",
    content: (
      <>
        <p>JavaVisual is a work in progress, and feedback is welcome. Share bugs, feature requests, questions, or suggestions.</p>
        <ul>
          <li><b>Bug report:</b> Describe what happened and what you expected.</li>
          <li><b>Feature idea:</b> Explain what would make JavaVisual more useful.</li>
          <li><b>General feedback:</b> Share questions and suggestions.</li>
        </ul>
        <p><a href="https://github.com/ronaldorick2007-design/JavaLens/issues/new" target="_blank" rel="noreferrer">Report a bug or suggest a feature</a></p>
        <p><a href="https://github.com/ronaldorick2007-design/JavaLens/discussions" target="_blank" rel="noreferrer">General feedback and discussions</a></p>
        <p>Thanks for trying JavaVisual and helping it improve!</p>
      </>
    ),
  },
];

function Code({ children }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(String(children));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <pre className="guide-code">
      <button
        type="button"
        className="guide-copy"
        onClick={copyCode}
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <code>{children}</code>
    </pre>
  );
}

export default function Documentation() {
  const [openSection, setOpenSection] = useState(0);

  return (
    <main className="h-full max-h-full min-h-0 w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-8 text-[var(--text)]">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">JavaVisual Documentation</p>
        <h1 className="mt-2 text-3xl font-bold">User Guide</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Learn how to run programs and visualize execution, variables, objects, and data structures.</p>
      </header>

      <div className="space-y-3">
        {sections.map((section, index) => {
          const isOpen = openSection === index;
          return (
            <section key={section.title} className="overflow-hidden rounded-xl border border-[var(--border)]">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`documentation-panel-${index}`}
                onClick={() => setOpenSection((current) => current === index ? -1 : index)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left font-semibold transition hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <span>{section.title}</span>
                <span className="text-[var(--muted)]" aria-hidden="true">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div id={`documentation-panel-${index}`} className="guide-content border-t border-[var(--border)] px-4 py-4">
                  {section.content}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <style>{`
        .guide-content {
          font-size: 0.9rem;
          line-height: 1.7;
          overflow-wrap: anywhere;
        }
        .guide-content p { margin: 0.65rem 0; }
        .guide-content ul, .guide-content ol { padding-left: 1.25rem; }
        .guide-content ul { list-style: disc; }
        .guide-content ol { list-style: decimal; }
        .guide-content li { margin: 0.4rem 0; }
        .guide-code {
          position: relative;
          max-width: 100%;
          overflow-x: auto;
          margin: 0.7rem 0 1rem;
          padding: 2.5rem 1rem 0.9rem;
          border: 1px solid var(--border);
          border-radius: 0.65rem;
          background: var(--code-bg, var(--hover));
          font: 0.8rem/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
          white-space: pre;
        }
        .guide-copy {
          position: absolute;
          top: 0.45rem;
          right: 0.5rem;
          padding: 0.2rem 0.55rem;
          border: 1px solid var(--border);
          border-radius: 0.4rem;
          background: var(--hover);
          color: var(--text);
          font: 0.7rem/1.4 ui-sans-serif, system-ui, sans-serif;
          cursor: pointer;
        }
        .guide-copy:hover { opacity: 0.8; }
        .guide-copy:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }
        .guide-content code:not(pre code) {
          border-radius: 0.25rem;
          padding: 0.1rem 0.25rem;
          background: var(--hover);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .guide-content a { text-decoration: underline; text-underline-offset: 3px; }
      `}</style>
    </main>
  );
}
