const initializeIpadLayout = () => {
  const main = document.querySelector('.rb-main')
  const left = main?.querySelector('.rb-col--left')
  const center = main?.querySelector('.rb-col--center')
  const right = main?.querySelector('.rb-col--right')

  if (!main || !left || !center || !right) return

  const command = left.querySelector('[aria-labelledby="m-cmd"]')
  const history = left.querySelector('[aria-labelledby="m-hist"]')
  const joints = right.querySelector('[aria-labelledby="m-j"]')
  const charts = right.querySelector('[aria-labelledby="m-t"]')

  if (!command || !history || !joints || !charts) return

  const visual = document.createElement('section')
  visual.className = 'ipad-visual'
  visual.setAttribute('aria-label', 'Robot visualization and cameras')
  visual.append(center)

  const panel = document.createElement('section')
  panel.className = 'ipad-panel'
  panel.setAttribute('aria-label', 'Robot controls and telemetry')

  const tabs = document.createElement('div')
  tabs.className = 'ipad-tabs'
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Control panels')

  const definitions = [
    { id: 'control', label: 'Điều khiển', cards: [command, history] },
    { id: 'joints', label: 'Trạng thái khớp', cards: [joints] },
    { id: 'charts', label: 'Biểu đồ', cards: [charts] }
  ]

  const panels = []
  const buttons = []

  const activateTab = (index) => {
    buttons.forEach((button, item) => {
      button.setAttribute('aria-selected', item === index ? 'true' : 'false')
      button.tabIndex = item === index ? 0 : -1
    })
    panels.forEach((content, item) => {
      content.hidden = item !== index
    })
  }

  definitions.forEach((definition, index) => {
    const button = document.createElement('button')
    button.className = 'ipad-tab'
    button.type = 'button'
    button.id = `ipad-tab-${definition.id}`
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', `ipad-panel-${definition.id}`)
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
    button.tabIndex = index === 0 ? 0 : -1
    button.textContent = definition.label

    const content = document.createElement('div')
    content.className = 'ipad-tab-panel'
    content.id = `ipad-panel-${definition.id}`
    content.setAttribute('role', 'tabpanel')
    content.setAttribute('aria-labelledby', button.id)
    content.hidden = index !== 0

    definition.cards.forEach((card) => content.append(card))
    buttons.push(button)
    panels.push(content)
    tabs.append(button)
    panel.append(content)

    button.addEventListener('click', () => activateTab(index))
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? definitions.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : definitions.length - 1)) % definitions.length
      activateTab(next)
      buttons[next].focus()
    })
  })

  panel.prepend(tabs)
  main.replaceChildren(visual, panel)

  const commandBody = command.querySelector('.rb-card__body')
  const commandFields = commandBody?.querySelectorAll('.rb-field')
  if (commandFields?.length >= 3) {
    commandFields[0].hidden = true
    commandFields[2].hidden = true
  }

  const commandButton = command.querySelector('button[aria-disabled="true"]')
  if (commandButton) commandButton.setAttribute('aria-label', 'Gửi lệnh mô phỏng')

  const historyList = history.querySelector('.rb-history')
  if (historyList) historyList.setAttribute('aria-label', 'Các tác vụ gần đây')

  const jointTable = joints.querySelector('.rb-joints')
  if (jointTable && !jointTable.parentElement.classList.contains('ipad-joint-scroll')) {
    const originalParent = jointTable.parentElement
    const scroll = document.createElement('div')
    scroll.className = 'ipad-joint-scroll'
    originalParent.insertBefore(scroll, jointTable)
    scroll.append(jointTable)
  }

  const viewport = center.querySelector('.rb-viewport')
  const cameraTiles = [...center.querySelectorAll('.rb-camera')]
  cameraTiles.forEach((camera) => {
    const button = camera.querySelector('.rb-camera__head button')
    const image = camera.querySelector('.rb-camera__img')
    if (!button || !image || !viewport) return

    const swap = () => {
      const current = viewport.firstElementChild
      const replacement = image.firstElementChild
      if (!current || !replacement) return
      viewport.replaceChildren(replacement)
      image.replaceChildren(current)
      center.classList.toggle('ipad-swap-active')
      camera.classList.toggle('ipad-camera-expanded')
      viewport.setAttribute('aria-label', `Expanded ${camera.querySelector('.rb-camera__name')?.textContent || 'camera'} view`)
    }

    button.addEventListener('click', swap)
    image.addEventListener('dblclick', swap)
  })

  const headerName = document.querySelector('.rb-header__name')
  let tapCount = 0
  let tapTimer
  headerName?.addEventListener('click', () => {
    tapCount += 1
    clearTimeout(tapTimer)
    tapTimer = setTimeout(() => {
      tapCount = 0
    }, 650)
    if (tapCount === 3) {
      tapCount = 0
      window.location.search = '?dev=1'
    }
  })

  if (new URLSearchParams(window.location.search).get('dev') === '1') {
    document.documentElement.dataset.dev = '1'
    const scenarios = document.createElement('section')
    scenarios.className = 'rb-card ipad-dev-card'
    const scenarioNames = ['USB disconnected', 'Joint stalled', 'Camera frozen', 'Network lost', 'Robot offline', 'Gateway timeout', 'Tracking degraded', 'Encoder stale', 'Joint limit warning', 'Emergency stop', 'Command rejected', 'Command timeout', 'Low camera FPS', 'Telemetry delayed', 'Task failed']
    scenarios.innerHTML = '<div class="rb-card__head"><h2 class="rb-card__title">Development scenarios</h2></div><div class="rb-card__body"><div class="rb-muted">Preview-only scenario selection</div><div class="ipad-dev-actions"></div><p class="rb-help ipad-dev-note">Selecting a scenario does not send commands to the robot.</p></div>'
    const actions = scenarios.querySelector('.ipad-dev-actions')
    scenarioNames.forEach((name) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'rb-btn rb-btn--quiet'
      button.textContent = name
      button.setAttribute('aria-pressed', 'false')
      button.addEventListener('click', () => {
        actions.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', 'false'))
        button.setAttribute('aria-pressed', 'true')
      })
      actions.append(button)
    })
    panel.append(scenarios)
  }
}

document.addEventListener('DOMContentLoaded', initializeIpadLayout)
