// 统一自定义下拉 — 替代原生 <select>
/** @typedef {{ value: string, label: string, desc?: string, disabled?: boolean }} CcSelectOption */

const CHEVRON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'

/** @type {{ close: () => void } | null} */
let openPicker = null

/**
 * @param {{
 *   options?: CcSelectOption[],
 *   value?: string,
 *   placeholder?: string,
 *   onChange?: (value: string, option?: CcSelectOption) => void,
 *   variant?: 'form' | 'pill' | 'compact',
 *   menuPlacement?: 'below' | 'above' | 'auto',
 *   fullWidth?: boolean,
 *   icon?: string,
 *   activeClass?: string,
 *   className?: string,
 * }} opts
 */
export function createCcSelect(opts = {}) {
  const {
    options = [],
    value = '',
    placeholder = '请选择',
    onChange,
    variant = 'form',
    menuPlacement = 'auto',
    fullWidth = true,
    icon = '',
    activeClass = '',
    className = '',
  } = opts

  const root = document.createElement('div')
  root.className = [
    'cc-select',
    `cc-select--${variant}`,
    fullWidth ? 'cc-select--full' : '',
    className,
  ].filter(Boolean).join(' ')

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'cc-select-btn'
  btn.setAttribute('aria-haspopup', 'listbox')
  btn.setAttribute('aria-expanded', 'false')

  if (icon) {
    const iconEl = document.createElement('span')
    iconEl.className = 'cc-select-icon'
    iconEl.innerHTML = icon
    btn.appendChild(iconEl)
  }

  const labelEl = document.createElement('span')
  labelEl.className = 'cc-select-label'
  const chevron = document.createElement('span')
  chevron.className = 'cc-select-chevron'
  chevron.innerHTML = CHEVRON
  btn.append(labelEl, chevron)

  const menu = document.createElement('div')
  menu.className = 'cc-select-menu'
  menu.role = 'listbox'
  menu.hidden = true
  root.append(btn, menu)

  let currentValue = value ?? ''
  let placeholderText = placeholder

  function findOption(v) {
    return options.find(o => o.value === v)
  }

  function syncBtn() {
    const sel = findOption(currentValue)
    labelEl.textContent = sel ? sel.label : placeholderText
    btn.classList.toggle('cc-select-placeholder', !sel)
    btn.classList.toggle('cc-select-has-value', !!sel)
    if (activeClass) btn.classList.toggle(activeClass, !!sel && currentValue !== '')
  }

  function renderMenu() {
    menu.innerHTML = ''
    for (const opt of options) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'cc-select-item' + (opt.value === currentValue ? ' active' : '')
      item.role = 'option'
      item.setAttribute('aria-selected', opt.value === currentValue ? 'true' : 'false')
      if (opt.disabled) item.disabled = true
      const name = document.createElement('span')
      name.className = 'cc-select-item-label'
      name.textContent = opt.label
      item.appendChild(name)
      if (opt.desc) {
        const desc = document.createElement('span')
        desc.className = 'cc-select-item-desc'
        desc.textContent = opt.desc
        item.appendChild(desc)
      }
      item.onclick = () => {
        if (opt.disabled) return
        setValue(opt.value)
        close()
        onChange?.(opt.value, opt)
      }
      menu.appendChild(item)
    }
  }

  function applyPlacement() {
    const above = menuPlacement === 'above'
      || (menuPlacement === 'auto' && (variant === 'pill' || variant === 'compact'))
    menu.classList.toggle('cc-select-menu--above', above)
    menu.classList.toggle('cc-select-menu--below', !above)
  }

  function open() {
    if (openPicker && openPicker !== api) openPicker.close()
    openPicker = api
    root.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    menu.hidden = false
    applyPlacement()
    renderMenu()
  }

  function close() {
    root.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    menu.hidden = true
    if (openPicker === api) openPicker = null
  }

  function toggle() {
    if (root.classList.contains('open')) close()
    else open()
  }

  function setValue(v) {
    currentValue = v ?? ''
    syncBtn()
    if (root.classList.contains('open')) renderMenu()
  }

  function getValue() {
    return currentValue
  }

  function setOptions(next) {
    options.length = 0
    options.push(...next)
    if (!findOption(currentValue)) currentValue = ''
    syncBtn()
    if (root.classList.contains('open')) renderMenu()
  }

  function setPlaceholder(text) {
    placeholderText = text
    syncBtn()
  }

  function destroy() {
    close()
    document.removeEventListener('mousedown', onOutside)
    root.remove()
  }

  function onOutside(e) {
    if (!root.contains(e.target)) close()
  }

  btn.addEventListener('click', e => {
    e.stopPropagation()
    toggle()
  })
  document.addEventListener('mousedown', onOutside)

  const api = { el: root, setValue, getValue, setOptions, setPlaceholder, close, destroy, open, syncBtn }
  syncBtn()
  return api
}

/**
 * 挂载到容器，替代原生 select（原生 select 隐藏保留供表单读取）
 * @param {HTMLSelectElement|string} selectOrId
 * @param {Parameters<typeof createCcSelect>[0]} opts
 */
export function mountCcSelect(selectOrId, opts = {}) {
  const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId
  if (!select) return null
  const options = [...select.options].map(o => ({
    value: o.value,
    label: o.textContent || o.value,
    disabled: o.disabled,
  }))
  const cc = createCcSelect({
    ...opts,
    options,
    value: select.value,
    placeholder: opts.placeholder || (select.options[0]?.value === '' ? select.options[0].textContent : '请选择'),
    onChange: (v, opt) => {
      select.value = v
      select.dispatchEvent(new Event('change', { bubbles: true }))
      opts.onChange?.(v, opt)
    },
  })
  select.hidden = true
  select.style.display = 'none'
  select.after(cc.el)
  const origSetValue = cc.setValue.bind(cc)
  cc.setValue = v => {
    origSetValue(v)
    select.value = v
  }
  return cc
}

/** 扫描容器内所有 select，自动替换（跳过已处理） */
export function enhanceSelects(root = document) {
  root.querySelectorAll('select:not([data-cc-select-skip])').forEach(sel => {
    if (sel.dataset.ccSelectDone) return
    sel.dataset.ccSelectDone = '1'
    const inModal = !!sel.closest('.modal')
    const inSetRow = !!sel.closest('.set-row')
    const compact = sel.classList.contains('bb-cp-sel')
    mountCcSelect(sel, {
      variant: compact ? 'compact' : (inModal || inSetRow ? 'form' : 'form'),
      menuPlacement: compact ? 'below' : 'auto',
      fullWidth: !compact,
    })
  })
}
