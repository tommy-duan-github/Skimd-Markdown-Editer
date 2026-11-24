export class EditorPane {
  readonly textarea: HTMLTextAreaElement;
  readonly formatBtn: HTMLButtonElement;
  private readonly toolbar: HTMLElement;
  private onChangeCallback: (value: string) => void;
  private onFormatCallback?: () => void;

  constructor(
    container: HTMLElement,
    onChange: (value: string) => void,
    onFormat?: () => void
  ) {
    this.onChangeCallback = onChange;
    this.onFormatCallback = onFormat;
    container.innerHTML = `
      <div class="editor-toolbar hidden">
        <span class="editor-toolbar-label">Source</span>
        <button type="button" class="mini-btn" id="editor-format-btn" title="Pretty-format source">Format</button>
      </div>
      <textarea class="editor-textarea" spellcheck="false" aria-label="Document source editor"></textarea>
    `;
    this.toolbar = container.querySelector('.editor-toolbar') as HTMLElement;
    this.formatBtn = container.querySelector('#editor-format-btn') as HTMLButtonElement;
    this.textarea = container.querySelector('.editor-textarea') as HTMLTextAreaElement;

    this.formatBtn.addEventListener('click', () => {
      this.onFormatCallback?.();
    });

    this.textarea.addEventListener('input', () => {
      this.onChangeCallback(this.textarea.value);
    });

    // Lightweight Tab key indentation support
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const val = this.textarea.value;
        this.textarea.value = val.slice(0, start) + '  ' + val.slice(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
        this.onChangeCallback(this.textarea.value);
      }
    });
  }

  setShowFormatToolbar(show: boolean): void {
    this.toolbar.classList.toggle('hidden', !show);
  }

  setValue(content: string): void {
    if (this.textarea.value !== content) {
      this.textarea.value = content;
    }
  }

  setWordWrap(wrap: boolean): void {
    this.textarea.classList.toggle('no-wrap', !wrap);
  }

  focus(): void {
    this.textarea.focus();
  }
}
