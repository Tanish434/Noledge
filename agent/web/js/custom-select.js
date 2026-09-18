// Custom Modern Dropdown Component
// Replaces native <select> elements with sleek, accessible, glassmorphic dropdowns

export class CustomSelect {
  constructor(selectEl, config = {}) {
    this.selectEl = selectEl;
    this.config = {
      searchable: false,
      placeholder: "Select an option",
      searchPlaceholder: "Search...",
      customRender: null,
      align: "left", // 'left' | 'right' | 'center'
      width: "auto",
      ...config
    };

    this.isOpen = false;
    this.highlightedIndex = -1;
    this.init();
  }

  init() {
    if (!this.selectEl) return;

    // Hide native select
    this.selectEl.style.display = "none";

    // Container
    this.container = document.createElement("div");
    this.container.className = `custom-select-container ${this.config.className || ""}`;
    if (this.config.width !== "auto") {
      this.container.style.width = this.config.width;
    }

    // Trigger button
    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "custom-select-trigger";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");

    this.triggerText = document.createElement("span");
    this.triggerText.className = "custom-select-trigger-text";

    this.triggerArrow = document.createElement("span");
    this.triggerArrow.className = "custom-select-trigger-arrow";
    this.triggerArrow.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;

    this.trigger.appendChild(this.triggerText);
    this.trigger.appendChild(this.triggerArrow);
    this.container.appendChild(this.trigger);

    // Dropdown popover
    this.dropdown = document.createElement("div");
    this.dropdown.className = `custom-select-dropdown align-${this.config.align}`;
    this.dropdown.setAttribute("role", "listbox");

    // Optional Search Bar
    if (this.config.searchable) {
      this.searchWrapper = document.createElement("div");
      this.searchWrapper.className = "custom-select-search-wrap";
      this.searchInput = document.createElement("input");
      this.searchInput.type = "text";
      this.searchInput.className = "custom-select-search-input";
      this.searchInput.placeholder = this.config.searchPlaceholder;
      this.searchInput.autocomplete = "off";

      this.searchWrapper.innerHTML = `
        <svg class="custom-select-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      `;
      this.searchWrapper.appendChild(this.searchInput);
      this.dropdown.appendChild(this.searchWrapper);

      this.searchInput.addEventListener("input", (e) => {
        this.filterOptions(e.target.value);
      });

      this.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.close();
        }
      });
    }

    // Options list wrapper
    this.optionsList = document.createElement("div");
    this.optionsList.className = "custom-select-options";
    this.dropdown.appendChild(this.optionsList);

    this.container.appendChild(this.dropdown);

    // Insert container right next to the select element
    this.selectEl.parentNode.insertBefore(this.container, this.selectEl.nextSibling);

    // Build options from select
    this.buildOptions();

    // Event listeners
    this.trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener("click", (e) => {
      if (!this.container.contains(e.target)) {
        this.close();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });

    // Sync when select value changes externally
    this.selectEl.addEventListener("change", () => {
      this.syncFromSelect();
    });

    // Observer for programmatic option additions (e.g. dynamic orb variants)
    const observer = new MutationObserver(() => {
      this.buildOptions();
    });
    observer.observe(this.selectEl, { childList: true, subtree: true });
  }

  buildOptions() {
    this.optionsList.innerHTML = "";
    this.items = [];

    const options = Array.from(this.selectEl.options);
    if (options.length === 0) {
      this.triggerText.textContent = this.config.placeholder;
      return;
    }

    const currentValue = this.selectEl.value;

    options.forEach((opt, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = "custom-select-option";
      itemEl.dataset.value = opt.value;
      itemEl.dataset.index = idx;
      itemEl.setAttribute("role", "option");

      const isSelected = opt.value === currentValue;
      if (isSelected) {
        itemEl.classList.add("selected");
        itemEl.setAttribute("aria-selected", "true");
      }

      if (this.config.customRender) {
        itemEl.innerHTML = this.config.customRender(opt);
      } else {
        itemEl.innerHTML = `
          <span class="custom-option-label">${opt.textContent}</span>
          <svg class="custom-option-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      }

      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectValue(opt.value);
        this.close();
      });

      this.optionsList.appendChild(itemEl);
      this.items.push({ el: itemEl, value: opt.value, text: opt.textContent.toLowerCase(), opt });
    });

    this.syncFromSelect();
  }

  filterOptions(query) {
    const q = query.trim().toLowerCase();
    let hasVisible = false;

    this.items.forEach((item) => {
      const match = !q || item.text.includes(q);
      item.el.style.display = match ? "flex" : "none";
      if (match) hasVisible = true;
    });

    let emptyEl = this.optionsList.querySelector(".custom-select-empty");
    if (!hasVisible) {
      if (!emptyEl) {
        emptyEl = document.createElement("div");
        emptyEl.className = "custom-select-empty";
        emptyEl.textContent = "No matches found";
        this.optionsList.appendChild(emptyEl);
      }
    } else if (emptyEl) {
      emptyEl.remove();
    }
  }

  selectValue(val) {
    if (this.selectEl.value !== val) {
      this.selectEl.value = val;
      this.selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.syncFromSelect();
  }

  syncFromSelect() {
    const val = this.selectEl.value;
    let selectedText = this.config.placeholder;

    this.items.forEach((item) => {
      const isSel = item.value === val;
      item.el.classList.toggle("selected", isSel);
      item.el.setAttribute("aria-selected", isSel ? "true" : "false");
      if (isSel) {
        selectedText = item.opt.textContent;
      }
    });

    if (this.config.formatTriggerText) {
      this.triggerText.textContent = this.config.formatTriggerText(selectedText, val);
    } else {
      this.triggerText.textContent = selectedText;
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    // Close other open dropdowns
    document.querySelectorAll(".custom-select-container.open").forEach((el) => {
      if (el !== this.container) el.classList.remove("open");
    });

    this.isOpen = true;
    this.container.classList.add("open");
    this.trigger.setAttribute("aria-expanded", "true");

    // Clear search and reset filter
    if (this.searchInput) {
      this.searchInput.value = "";
      this.filterOptions("");
      setTimeout(() => this.searchInput.focus(), 60);
    }

    // Scroll active item into view
    const selectedItem = this.optionsList.querySelector(".custom-select-option.selected");
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }

  close() {
    this.isOpen = false;
    this.container.classList.remove("open");
    this.trigger.setAttribute("aria-expanded", "false");
  }

  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.selectEl) {
      this.selectEl.style.display = "";
    }
  }
}
