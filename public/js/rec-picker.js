// Seletor de recorrência dos retornos: dias da semana (com horário próprio para
// cada dia), frequência, quando começa e quando termina. Monta a lista de datas
// no navegador e confere no servidor quais horários já estão ocupados.
//
//   const rec = new RecPicker(el, { duration: () => 60 })
//   rec.reset({ start: '2026-11-03', time: '08:00', days: [1, 4], count: 8 })
//   rec.dates()  → [{ date: '2026-11-03', time: '08:00' }, …]  (sem as removidas)
;(function () {
  const DOW = [
    { d: 1, short: 'Seg', long: 'Segunda' },
    { d: 2, short: 'Ter', long: 'Terça' },
    { d: 3, short: 'Qua', long: 'Quarta' },
    { d: 4, short: 'Qui', long: 'Quinta' },
    { d: 5, short: 'Sex', long: 'Sexta' },
    { d: 6, short: 'Sáb', long: 'Sábado' },
    { d: 0, short: 'Dom', long: 'Domingo' }
  ]
  const MAX = 104
  const pad = n => String(n).padStart(2, '0')
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const parse = s => new Date(s + 'T12:00:00')
  const key = x => `${x.date} ${x.time}`

  class RecPicker {
    constructor(root, opts = {}) {
      this.root = root
      this.opts = opts
      this.state = null
      this.conflicts = new Set()
      this._timer = null
      this._seq = 0
      root.addEventListener('click', e => this._click(e))
      root.addEventListener('input', e => this._input(e))
      root.addEventListener('change', e => this._input(e))
    }

    reset({ start, time = '09:00', days, count = 4, every = 1 } = {}) {
      const first = start || isoDate(new Date())
      const dows = days && days.length ? days : [parse(first).getDay()]
      this.state = {
        start: first,
        every,
        end: 'count',
        count,
        until: '',
        days: new Set(dows),
        times: Object.fromEntries(dows.map(d => [d, time])),
        baseTime: time,
        excluded: new Set()
      }
      this.conflicts = new Set()
      this.render()
    }

    // Datas candidatas, em ordem; as removidas pela profissional ficam de fora
    _generate() {
      const s = this.state
      const out = []
      if (!s.days.size || !s.start) return out
      const start = parse(s.start)
      // Semanas contadas a partir da segunda-feira da semana de início
      const monday = new Date(start)
      monday.setDate(start.getDate() - ((start.getDay() + 6) % 7))
      const until = s.end === 'until' && s.until ? parse(s.until) : null
      const want = s.end === 'count' ? Math.min(Math.max(parseInt(s.count) || 1, 1), MAX) : MAX
      const d = new Date(start)
      for (let guard = 0; guard < 800 && out.length < want; guard++, d.setDate(d.getDate() + 1)) {
        if (until && d > until) break
        if (!s.days.has(d.getDay())) continue
        const week = Math.floor((d - monday) / (7 * 86400000))
        if (week % s.every) continue
        const item = { date: isoDate(d), time: s.times[d.getDay()] || s.baseTime }
        if (s.excluded.has(key(item))) continue
        out.push(item)
      }
      return out
    }

    dates() { return this.state ? this._generate() : [] }

    // Primeira data/hora escolhida (para o agendamento principal da agenda)
    first() { return this.dates()[0] || null }

    _click(e) {
      const b = e.target.closest('button')
      if (!b || !this.root.contains(b)) return
      e.preventDefault()
      const s = this.state
      if (b.dataset.dow != null) {
        const d = +b.dataset.dow
        if (s.days.has(d)) { if (s.days.size > 1) s.days.delete(d) }
        else { s.days.add(d); s.times[d] = s.times[d] || s.baseTime }
      } else if (b.dataset.every) {
        s.every = +b.dataset.every
      } else if (b.dataset.end) {
        s.end = b.dataset.end
        if (s.end === 'until' && !s.until) {
          const u = parse(s.start); u.setMonth(u.getMonth() + 1); s.until = isoDate(u)
        }
      } else if (b.dataset.count) {
        s.end = 'count'; s.count = +b.dataset.count
      } else if (b.dataset.drop) {
        s.excluded.add(b.dataset.drop)
      } else return
      this.render()
    }

    _input(e) {
      const t = e.target, s = this.state
      if (!t.dataset.f) return
      if (t.dataset.f === 'time') {
        s.times[+t.dataset.dow] = t.value
        // Mesmo horário para todos? Muda o padrão dos dias novos também
        s.baseTime = t.value || s.baseTime
      } else if (t.dataset.f === 'start') s.start = t.value
      else if (t.dataset.f === 'count') s.count = t.value
      else if (t.dataset.f === 'until') s.until = t.value
      // Só a prévia muda — redesenhar tudo tiraria o foco do campo em edição
      this._renderPreview()
    }

    render() {
      const s = this.state
      if (!s) return
      const days = DOW.map(x =>
        `<button type="button" class="rec-day ${s.days.has(x.d) ? 'on' : ''}" data-dow="${x.d}">${x.short}</button>`).join('')
      const times = DOW.filter(x => s.days.has(x.d)).map(x => `
        <div class="rec-time-row"><b>${x.long}</b>
          <input type="time" class="form-control" data-f="time" data-dow="${x.d}" value="${s.times[x.d] || s.baseTime}" step="900">
        </div>`).join('')
      const pkg = this.opts.packageLeft?.()
      const quick = [4, 8, 10, 12].map(n => `<button type="button" data-count="${n}">${n}</button>`).join('')
        + (pkg ? `<button type="button" data-count="${pkg}">Pacote: ${pkg}</button>` : '')

      this.root.innerHTML = `
        <div class="form-group">
          <label class="form-label">Dias da semana <span style="color:var(--subtle)">— toque para marcar quantos quiser</span></label>
          <div class="rec-days">${days}</div>
          <div class="rec-times">${times}</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Começa em</label>
            <input type="date" class="form-control" data-f="start" value="${s.start}">
          </div>
          <div class="form-group">
            <label class="form-label">Repetir</label>
            <div class="seg">
              <button type="button" data-every="1" class="${s.every === 1 ? 'on' : ''}">Toda semana</button>
              <button type="button" data-every="2" class="${s.every === 2 ? 'on' : ''}">A cada 2 semanas</button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Termina</label>
          <div class="seg" style="margin-bottom:0.5rem">
            <button type="button" data-end="count" class="${s.end === 'count' ? 'on' : ''}">Após um nº de sessões</button>
            <button type="button" data-end="until" class="${s.end === 'until' ? 'on' : ''}">Em uma data</button>
          </div>
          ${s.end === 'count' ? `
            <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
              <input type="number" class="form-control" data-f="count" min="1" max="${MAX}" value="${s.count}" style="max-width:110px">
              <span style="font-size:0.84rem;color:var(--muted)">sessões</span>
              <div class="rec-quick">${quick}</div>
            </div>` : `
            <input type="date" class="form-control" data-f="until" value="${s.until}" style="max-width:200px">`}
        </div>
        <div class="rec-preview" data-preview></div>`
      this._renderPreview()
    }

    _renderPreview() {
      const box = this.root.querySelector('[data-preview]')
      if (!box) return
      const list = this._generate()
      const busy = list.filter(x => this.conflicts.has(key(x))).length
      const fmt = x => {
        const d = parse(x.date)
        return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${x.time}`
      }
      const chips = list.map(x => {
        const c = this.conflicts.has(key(x))
        return `<span class="rec-date ${c ? 'conflict' : ''}" title="${c ? 'Horário já ocupado — será pulado' : ''}">${fmt(x)}<button type="button" data-drop="${key(x)}" title="Remover esta data">×</button></span>`
      }).join('')
      const removed = this.state.excluded.size
      const n = list.length - busy
      const noun = this.opts.noun || 'retorno'
      box.innerHTML = `
        <div class="rec-preview-head">
          <b>${n} ${noun}${n === 1 ? '' : 's'} a agendar</b>
          <span>${busy ? `${busy} horário(s) ocupado(s) será(ão) pulado(s) · ` : ''}${removed ? `<a href="#" data-restore style="color:var(--brand-700)">desfazer remoções</a>` : 'toque no × para tirar uma data'}</span>
        </div>
        <div class="rec-dates">${chips || '<span style="font-size:0.8rem;color:var(--muted)">Escolha ao menos um dia da semana.</span>'}</div>`
      const undo = box.querySelector('[data-restore]')
      if (undo) undo.onclick = ev => { ev.preventDefault(); this.state.excluded.clear(); this.render() }
      this.opts.onChange?.(list)
      this._checkSoon(list)
    }

    _checkSoon(list) {
      clearTimeout(this._timer)
      this._timer = setTimeout(() => this._check(list), 350)
    }

    async _check(list) {
      const seq = ++this._seq
      const duration = parseInt(this.opts.duration?.()) || 60
      const ignore = this.opts.ignore?.()   // agendamento sendo editado não conflita consigo
      try {
        const r = await fetch('/api/appointments/conflicts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: list.map(x => ({ ...x, duration_minutes: duration })) })
        })
        if (!r.ok || seq !== this._seq) return
        const { conflicts } = await r.json()
        const next = new Set(list.filter((x, i) => conflicts[i] && !(ignore && key(x) === ignore)).map(key))
        const same = next.size === this.conflicts.size && [...next].every(k => this.conflicts.has(k))
        this.conflicts = next
        if (!same) this._renderPreview()
      } catch (_) {}
    }
  }

  window.RecPicker = RecPicker
})()
