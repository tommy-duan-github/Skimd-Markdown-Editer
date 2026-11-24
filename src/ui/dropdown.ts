import { escapeHtml } from '../lib/formats.ts';
import { ICON_CHEVRON_DOWN } from './icons.ts';

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownConfig {
  options: DropdownOption[];
  value: string;
  variant?: 'pill' | 'field';
  ariaLabel?: string;
  title?: string;
  onChange: (value: string) => void;
}

let activeOpenDropdown: SkimdDropdown | null = null;

export class SkimdDropdown {
  private readonly trigger: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly menu: HTMLDivElement;
  private options: DropdownOption[];
  private currentValue: string;
  private readonly onChange: (value: string) => void;
  private isOpen = false;
  private readonly onDocPointerDown: (e: MouseEvent) => void;
  private readonly onDocKeyDown: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, config: DropdownConfig) {
    this.options = config.options;
    this.currentValue = config.value;
    this.onChange = config.onChange;

    const variant = config.variant ?? 'field';
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = `skimd-select skimd-select-${variant}`;
    if (config.ariaLabel) this.trigger.setAttribute('aria-label', config.ariaLabel);
    if (config.title) this.trigger.title = config.title;
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.innerHTML = `<span class="skimd-select-label"></span><span class="skimd-select-caret">${ICON_CHEVRON_DOWN}</span>`;

    this.labelEl = this.trigger.querySelector('.skimd-select-label') as HTMLElement;

    this.menu = document.createElement('div');
    this.menu.className = 'skimd-select-menu hidden';
    this.menu.setAttribute('role', 'listbox');

    container.appendChild(this.trigger);
    document.body.appendChild(this.menu);

    this.syncLabel();
    this.renderMenu();

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          this.stepSelection(e.key === 'ArrowDown' ? 1 : -1);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.isOpen) this.close();
        else this.open();
      }
    });

    this.onDocPointerDown = (e: MouseEvent) => {
      if (!this.isOpen) return;
      const target = e.target as Node;
      if (!this.trigger.contains(target) && !this.menu.contains(target)) {
        this.close();
      }
    };

    this.onDocKeyDown = (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.trigger.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.stepSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    };

    document.addEventListener('mousedown', this.onDocPointerDown);
    document.addEventListener('keydown', this.onDocKeyDown);
  }

  get value(): string {
    return this.currentValue;
  }

  setValue(val: string): void {
    this.currentValue = val;
    this.syncLabel();
    this.renderMenu();
  }

  destroy(): void {
    this.close();
    document.removeEventListener('mousedown', this.onDocPointerDown);
    document.removeEventListener('keydown', this.onDocKeyDown);
    this.trigger.remove();
    this.menu.remove();
  }

  private syncLabel(): void {
    const match = this.options.find((o) => o.value === this.currentValue);
    this.labelEl.textContent = match ? match.label : this.currentValue;
  }

  private renderMenu(): void {
    this.menu.innerHTML = this.options
      .map(
        (opt) => `<button type="button" role="option" class="skimd-select-option${
          opt.value === this.currentValue ? ' active' : ''
        }" aria-selected="${opt.value === this.currentValue ? 'true' : 'false'}" data-opt-value="${escapeHtml(
          opt.value
        )}">${escapeHtml(opt.label)}</button>`
      )
      .join('');

    this.menu.querySelectorAll<HTMLButtonElement>('.skimd-select-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextVal = btn.dataset.optValue ?? '';
        if (nextVal !== this.currentValue) {
          this.currentValue = nextVal;
          this.syncLabel();
          this.renderMenu();
          this.onChange(nextVal);
        }
        this.close();
      });
    });
  }

  private open(): void {
    if (activeOpenDropdown && activeOpenDropdown !== this) {
      activeOpenDropdown.close();
    }
    activeOpenDropdown = this;
    this.isOpen = true;
    this.trigger.classList.add('open');
    this.trigger.setAttribute('aria-expanded', 'true');

    this.menu.classList.remove('hidden');
    const rect = this.trigger.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 130);
    this.menu.style.minWidth = `${minWidth}px`;

    const menuRect = this.menu.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuRect.height + 16 && rect.top > menuRect.height + 16;

    const top = openUp ? rect.top - menuRect.height - 6 : rect.bottom + 6;
    const left = Math.min(
      window.innerWidth - Math.max(minWidth, menuRect.width) - 10,
      Math.max(10, rect.right - Math.max(minWidth, menuRect.width))
    );

    this.menu.style.top = `${top}px`;
    this.menu.style.left = `${left}px`;
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (activeOpenDropdown === this) activeOpenDropdown = null;
    this.trigger.classList.remove('open');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.menu.classList.add('hidden');
  }

  private stepSelection(delta: number): void {
    if (this.options.length === 0) return;
    const idx = this.options.findIndex((o) => o.value === this.currentValue);
    const nextIdx = (idx + delta + this.options.length) % this.options.length;
    const nextVal = this.options[nextIdx].value;
    this.currentValue = nextVal;
    this.syncLabel();
    this.renderMenu();
    this.onChange(nextVal);
  }
}
