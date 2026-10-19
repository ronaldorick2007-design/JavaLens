import { useState } from "react";

const sections = [
  {
    title: "1. Getting Started",
    content: (
      <>
        <p>Open an existing Java file or create a new one. Paste the demo, save it, then click <b>Visual</b> in the top-right corner.</p>
        <Code>{`public class Main {
    public static void main(String[] args) {
        int[] numbers = {10, 20, 30, 40};

        for (int i = 0; i < numbers.length; i++) {
            numbers[i] += 5;
        }
    }
}`}</Code>
        <p>Explore how the array and loop variables change during execution.</p>
      </>
    ),
  },
  {
    title: "2. Using point()",
    content: (
      <>
        <p><code>point()</code> highlights a particular array element or object at a specific point in your program.</p>
        <p><b>Function signature</b></p>
        <Code>{`static void point(Object object, String color, int... indices);`}</Code>
        <ul>
          <li><code>object</code>: the array or object to highlight.</li>
          <li><code>color</code>: a color string such as <code>"red"</code> or <code>"blue"</code>.</li>
          <li><code>indices</code>: optional array index or matrix row and column.</li>
        </ul>
        <p><b>Array element</b></p>
        <Code>{`int[] numbers = {10, 20, 30, 40};
point(numbers, "red", 2);
numbers[2] = 99;`}</Code>
        <p>Highlights index 2, initially containing 30.</p>
        <p><b>Linked-list node</b></p>
        <Code>{`Node current = head;
point(current, "blue");

// Or directly:
point(sll.head, "blue");`}</Code>
        <p>Highlights the referenced node.</p>
        <p><b>Matrix element</b></p>
        <Code>{`int[][] matrix = {
    {1, 2, 3},
    {4, 5, 6}
};

point(matrix, "blue", 1, 2);`}</Code>
        <p>Highlights the element at row 1, column 2: value 6.</p>
        <p><b>Quick reference</b></p>
        <Code>{`point(array, "red", index);
point(matrix, "blue", row, column);
point(object, "green");`}</Code>
        <p>Place each call where you want the highlight to appear. Indices start at 0.</p>
      </>
    ),
  },
  {
    title: "3. Using visual()",
    content: (
      <>
        <p><code>visual()</code> registers a data structure as a <b>visual bucket</b>. Register it once; JavaLens then captures its changing state as the program executes.</p>
        <p><b>Function signatures</b></p>
        <Code>{`static void visual(Object object, String type);
static void visual(Object object, String type, String component);`}</Code>
        <p><b>When to register</b></p>
        <p>Call <code>visual()</code> immediately after constructing the structure, even when it is initially empty. Do not call it again after every insertion or modification.</p>
        <p><b>Type: "array"</b></p>
        <Code>{`int[] arr = {10, 20, 30, 40};
visual(arr, "array");`}</Code>
        <p>Displays a one-dimensional array directly. No <code>toDisplay()</code> method is needed.</p>
        <p><b>Type: "matrix"</b></p>
        <Code>{`int[][] matrix = {
    {1, 2, 3},
    {4, 5, 6}
};
visual(matrix, "matrix");`}</Code>
        <p>Displays a two-dimensional array as rows and columns.</p>
        <p><b>Type: "linear"</b></p>
        <Code>{`visual(playlist, "linear", "song");`}</Code>
        <p>For custom linked lists, stacks, queues, and similar structures, provide a <code>toDisplay()</code> method returning an ordered array or <code>ArrayList</code>. The third argument identifies the field containing each element's displayed data.</p>
        <p><b>Example: linked playlist</b></p>
        <Code>{`import java.util.ArrayList;

class Node {
    String song;
    Node next;

    Node(String song) {
        this.song = song;
    }
}

class Playlist {
    Node head;

    void add(String song) {
        Node node = new Node(song);
        if (head == null) {
            head = node;
            return;
        }

        Node current = head;
        while (current.next != null) {
            current = current.next;
        }
        current.next = node;
    }

    ArrayList<Node> toDisplay() {
        ArrayList<Node> result = new ArrayList<>();
        Node current = head;
        while (current != null) {
            result.add(current);
            current = current.next;
        }
        return result;
    }
}`}</Code>
        <p><b>Usage</b></p>
        <Code>{`Playlist playlist = new Playlist();
visual(playlist, "linear", "song");

playlist.add("Believer");
playlist.add("Faded");
playlist.add("Perfect");`}</Code>
        <p>The Watcher reads the list representation returned by <code>toDisplay()</code>; you do not need to implement <code>Iterator</code> or <code>Iterable</code> for visualization.</p>
        <p><b>Type: "tree"</b></p>
        <Code>{`visual(tree, "tree", "value");`}</Code>
        <p>For custom binary trees, <code>toDisplay()</code> should return nodes in level order (BFS) and preserve <code>null</code> placeholders for missing children. Tree positions use left child index <code>2 * i + 1</code> and right child index <code>2 * i + 2</code>.</p>
        <p><b>Example: binary tree</b></p>
        <Code>{`import java.util.ArrayList;
import java.util.LinkedList;
import java.util.Queue;

class Node {
    int value;
    Node left, right;

    Node(int value) {
        this.value = value;
    }
}

class BinaryTree {
    Node root;

    ArrayList<Node> toDisplay() {
        ArrayList<Node> result = new ArrayList<>();
        if (root == null) return result;

        Queue<Node> queue = new LinkedList<>();
        queue.add(root);

        while (!queue.isEmpty()) {
            Node current = queue.remove();
            result.add(current);
            if (current != null) {
                queue.add(current.left);
                queue.add(current.right);
            }
        }

        while (!result.isEmpty()
                && result.get(result.size() - 1) == null) {
            result.remove(result.size() - 1);
        }
        return result;
    }
}`}</Code>
        <p><b>Usage</b></p>
        <Code>{`BinaryTree tree = new BinaryTree();
visual(tree, "tree", "value");

tree.root = new Node(10);
tree.root.left = new Node(20);
tree.root.right = new Node(30);
tree.root.left.left = new Node(40);`}</Code>
        <p>The level-order representation is <code>[10, 20, 30, 40]</code> for this tree. For a root, left child, and left grandchild with no right child, it is <code>[10, 20, null, 40]</code>. Keep internal <code>null</code> slots so the visualizer preserves the correct shape.</p>
        <p><b>Type: "graph"</b></p>
        <Code>{`visual(graph, "graph", "adjList");`}</Code>
        <p>The component identifies the adjacency-list field. Use a representation supported by the Watcher's graph handling.</p>
        <Code>{`class Graph {
    int[][] adjList;

    Graph(int[][] adjList) {
        this.adjList = adjList;
    }
}

Graph graph = new Graph(new int[][] {
    {1, 2},
    {0, 2},
    {0, 1}
});
visual(graph, "graph", "adjList");`}</Code>
        <p>Each row contains the neighbors of a vertex. Here, vertex 0 connects to vertices 1 and 2.</p>
        <p><b>Quick reference</b></p>
        <ul>
          <li><code>"array"</code>: one-dimensional array.</li>
          <li><code>"matrix"</code>: two-dimensional array.</li>
          <li><code>"linear"</code>: custom structures should expose an ordered <code>toDisplay()</code> representation.</li>
          <li><code>"tree"</code>: use level-order <code>toDisplay()</code> output with internal <code>null</code> slots preserved.</li>
          <li><code>"graph"</code>: supported adjacency-list representation.</li>
        </ul>
      </>
    ),
  },
  {
    title: "4. Trick: Array-Based Heap",
    content: (
      <>
        <p>A binary heap is commonly stored in an array. Its array order corresponds to level-order tree indexing. For a custom heap wrapper, expose the values through <code>toDisplay()</code> rather than implementing an iterator just for visualization.</p>
        <Code>{`import java.util.ArrayList;

class Heap {
    int[] arr;

    Heap(int[] arr) {
        this.arr = arr;
    }

    ArrayList<Integer> toDisplay() {
        ArrayList<Integer> result = new ArrayList<>();
        for (int value : arr) {
            result.add(value);
        }
        return result;
    }
}`}</Code>
        <p>Use the wrapper only if the Watcher's tree handling supports the representation you provide. The values must be in the intended level-order shape; a heap is not necessarily a sorted array.</p>
      </>
    ),
  },
  {
    title: "5. Known Limitations",
    content: (
      <ul>
        <li>Direct array visualization supports one-dimensional and two-dimensional arrays.</li>
        <li>For custom linear structures, return an ordered array or <code>ArrayList</code> from <code>toDisplay()</code>.</li>
        <li>For trees, return level-order nodes and preserve internal <code>null</code> slots; trailing <code>null</code> entries may be trimmed.</li>
        <li>Graphs require a supported adjacency-list representation.</li>
        <li>The <code>component</code> argument must match the actual node-data or adjacency-list field.</li>
        <li>Register each visual bucket once. The displayed state is captured as execution proceeds.</li>
      </ul>
    ),
  },
  {
    title: "6. Feedback & Suggestions",
    content: (
      <>
        <p>JavaLens is a work in progress, and feedback is welcome! Found a bug, have a feature idea, or noticed something confusing? Feel free to share it.</p>
        <ul>
          <li><b>Bug report:</b> describe what happened and what you expected.</li>
          <li><b>Feature idea:</b> explain what would make JavaLens more useful.</li>
          <li><b>General feedback:</b> questions and informal suggestions are welcome too.</li>
          <li><b>Want to contribute?</b> Pull requests for code or documentation are appreciated.</li>
        </ul>
        <p>Use the project's GitHub Issues page for bugs and feature requests. Once GitHub Discussions is enabled, it can be used for open-ended questions and general conversation.</p>
        <p><b>Repository links:</b> Replace the placeholders below with your actual GitHub username and repository name before publishing.</p>
        <p><a href="https://github.com/ronaldorick2007-design/JavaLens/issues/new" target="_blank" rel="noreferrer">Report a bug or suggest a feature ↗</a></p>
        <p><a href="https://github.com/ronaldorick2007-design/JavaLens/discussions" target="_blank" rel="noreferrer">General feedback and discussions ↗</a></p>
        <p>Thanks for trying JavaLens and helping it improve!</p>
      </>
    ),
  },
];

function Code({ children }) {
  return (
    <pre className="guide-code">
      <code>{children}</code>
    </pre>
  );
}

export default function Documentation() {
  const [openSection, setOpenSection] = useState(0);

  return (
    <main className="h-full max-h-full min-h-0 w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-8 text-[var(--text)]">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          JavaLens Documentation
        </p>
        <h1 className="mt-2 text-3xl font-bold">User Guide</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Learn how to visualize Java execution, objects, and data structures.
        </p>
      </header>

      <div className="space-y-3">
        {sections.map((section, index) => {
          const isOpen = openSection === index;

          return (
            <section
              key={section.title}
              className="overflow-hidden rounded-xl border border-[var(--border)]"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`documentation-panel-${index}`}
                onClick={() =>
                  setOpenSection((current) => current === index ? -1 : index)
                }
                className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left font-semibold transition hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <span>{section.title}</span>
                <span className="text-[var(--muted)]" aria-hidden="true">
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              {isOpen && (
                <div
                  id={`documentation-panel-${index}`}
                  className="guide-content border-t border-[var(--border)] px-4 py-4"
                >
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
        .guide-content p {
          margin: 0.65rem 0;
        }
        .guide-content ul {
          list-style: disc;
          padding-left: 1.25rem;
        }
        .guide-content li {
          margin: 0.4rem 0;
        }
        .guide-code {
          max-width: 100%;
          overflow-x: auto;
          margin: 0.7rem 0 1rem;
          padding: 0.9rem 1rem;
          border: 1px solid var(--border);
          border-radius: 0.65rem;
          background: var(--code-bg, var(--hover));
          font: 0.8rem/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
          white-space: pre;
        }
        .guide-content code:not(pre code) {
          border-radius: 0.25rem;
          padding: 0.1rem 0.25rem;
          background: var(--hover);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .guide-content a {
          text-decoration: underline;
          text-underline-offset: 3px;
        }
      `}</style>
    </main>
  );
}
