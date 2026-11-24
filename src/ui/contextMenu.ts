import { escapeHtml } from '../lib/formats.ts';

export interface ContextMenuItem {
  label?: string;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
}

export class SkimdContextMenu {
  private readonly root: HTMLDivElement;
  private readonly subRoot: HTMLDivElement;
  private isOpen = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ctx-menu hidden';
    this.root.setAttribute('role', 'menu');

    this.subRoot = document.createElement('div');
    this.subRoot.className = 'ctx-menu ctx-submenu hidden';
    this.subRoot.setAttribute('role', 'menu');

    document.body.appendChild(this.root);
    document.body.appendChild(this.subRoot);

    document.addEventListener('mousedown', (e) => {
      if (!this.isOpen) return;
      const target = e.target as Node;
      if (!this.root.contains(target) && !this.subRoot.contains(target)) {
        this.close();
      }
    });

    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  show(x: number, y: number, items: ContextMenuItem[]): void {
    this.close();
    if (items.length === 0) return;
    this.isOpen = true;
    this.populate(this.root, items, true);
    this.root.classList.remove('hidden');

    const rect = this.root.getBoundingClientRect();
    const clampedX = Math.min(window.innerWidth - rect.width - 8, Math.max(8, x));
    const clampedY = Math.min(window.innerHeight - rect.height - 8, Math.max(8, y));
    this.root.style.left = `${clampedX}px`;
    this.root.style.top = `${clampedY}px`;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.subRoot.classList.add('hidden');
  }

  private populate(container: HTMLDivElement, items: ContextMenuItem[], allowSubmenu: boolean): void {
    container.innerHTML = items
      .map((item, idx) => {
        if (item.separator) {
          return '<div class="ctx-sep"></div>';
        }
        const hasSub = allowSubmenu && Array.isArray(item.submenu) && item.submenu.length > 0;
        const disabledAttr = item.disabled ? ' disabled' : '';
        return `<button type="button" role="menuitem" class="ctx-item${
          hasSub ? ' has-sub' : ''
        }" data-ctx-idx="${idx}"${disabledAttr}>
          <span>${escapeHtml(item.label ?? '')}</span>
          ${hasSub ? '<span class="ctx-arrow">▸</span>' : ''}
        </button>`;
      })
      .join('');

    container.querySelectorAll<HTMLButtonElement>('[data-ctx-idx]').forEach((btn) => {
      const item = items[Number(btn.dataset.ctxIdx)];
      if (!item || item.disabled) return;

      if (allowSubmenu && item.submenu && item.submenu.length > 0) {
        btn.addEventListener('mouseenter', () => {
          this.openSubmenu(btn, item.submenu!);
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openSubmenu(btn, item.submenu!);
        });
      } else {
        if (allowSubmenu) {
          btn.addEventListener('mouseenter', () => {
            this.subRoot.classList.add('hidden');
          });
        }
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
          item.onClick?.();
        });
      }
    });
  }

  private openSubmenu(parentBtn: HTMLButtonElement, items: ContextMenuItem[]): void {
    this.populate(this.subRoot, items, false);
    this.subRoot.classList.remove('hidden');

    const btnRect = parentBtn.getBoundingClientRect();
    const subRect = this.subRoot.getBoundingClientRect();
    const openLeft = btnRect.right + subRect.width + 10 > window.innerWidth;
    const left = openLeft
      ? Math.max(8, btnRect.left - subRect.width - 4)
      : btnRect.right + 4;
    const top = Math.min(window.innerHeight - subRect.height - 8, Math.max(8, btnRect.top - 6));

    this.subRoot.style.left = `${left}px`;
    this.subRoot.style.top = `${top}px`;
  }
}
