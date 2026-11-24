export class FindBar {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly countEl: HTMLElement;
  private readonly getTargetContainer: () => HTMLElement;
  private marks: HTMLElement[] = [];
  private activeIdx = -1;

  constructor(root: HTMLElement, getTargetContainer: () => HTMLElement) {
    this.root = root;
    this.getTargetContainer = getTargetContainer;
    this.root.className = 'find-bar hidden';
    this.root.innerHTML = `
      <input type="search" class="find-input" placeholder="Find in document…" aria-label="Find in document" />
      <span class="find-count">0/0</span>
      <button type="button" class="icon-btn" id="find-prev" title="Previous (Shift+Enter)">↑</button>
      <button type="button" class="icon-btn" id="find-next" title="Next (Enter)">↓</button>
      <button type="button" class="icon-btn" id="find-close" title="Close (Esc)">×</button>
    `;

    this.input = this.root.querySelector('.find-input') as HTMLInputElement;
    this.countEl = this.root.querySelector('.find-count') as HTMLElement;

    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this.root.querySelector('#find-prev')?.addEventListener('click', () => this.step(-1));
    this.root.querySelector('#find-next')?.addEventListener('click', () => this.step(1));
    this.root.querySelector('#find-close')?.addEventListener('click', () => this.close());
  }

  get opened(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (this.input.value) this.search();
  }

  close(): void {
    this.root.classList.add('hidden');
    this.clearHighlights();
  }

  refresh(): void {
    if (this.opened && this.input.value) {
      this.search();
    }
  }

  clearHighlights(): void {
    const container = this.getTargetContainer();
    const existing = container.querySelectorAll('mark.find-highlight');
    existing.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    });
    this.marks = [];
    this.activeIdx = -1;
    this.countEl.textContent = '0/0';
  }

  private search(): void {
    this.clearHighlights();
    const query = this.input.value.trim();
    if (!query) return;

    const lowerQuery = query.toLowerCase();
    const container = this.getTargetContainer();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parentEl = node.parentElement;
        if (!parentEl || parentEl.closest('script, style, .code-copy-btn')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? '';
      const lower = value.toLowerCase();
      let idx = lower.indexOf(lowerQuery);
      if (idx === -1) continue;

      const frag = document.createDocumentFragment();
      let lastPos = 0;
      while (idx !== -1) {
        if (idx > lastPos) {
          frag.appendChild(document.createTextNode(value.slice(lastPos, idx)));
        }
        const mark = document.createElement('mark');
        mark.className = 'find-highlight';
        mark.textContent = value.slice(idx, idx + query.length);
        frag.appendChild(mark);
        this.marks.push(mark);
        lastPos = idx + query.length;
        idx = lower.indexOf(lowerQuery, lastPos);
      }
      if (lastPos < value.length) {
        frag.appendChild(document.createTextNode(value.slice(lastPos)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    if (this.marks.length > 0) {
      this.activeIdx = 0;
      this.focusCurrent();
    } else {
      this.countEl.textContent = '0/0';
    }
  }

  private step(delta: number): void {
    if (this.marks.length === 0) return;
    this.activeIdx = (this.activeIdx + delta + this.marks.length) % this.marks.length;
    this.focusCurrent();
  }

  private focusCurrent(): void {
    this.marks.forEach((m, i) => m.classList.toggle('current', i === this.activeIdx));
    const current = this.marks[this.activeIdx];
    current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.countEl.textContent = `${this.activeIdx + 1}/${this.marks.length}`;
  }
}
