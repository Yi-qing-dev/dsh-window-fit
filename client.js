window.__ModuleLoader__.load({
  id: 'dsh-window-fit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/window-fit'

    const zh = (navigator.language || '').toLowerCase().startsWith('zh')
    const copy = zh
      ? {
          title: '窗口大小',
          description: '启动时按屏幕比例缩放窗口并居中（仅 Windows）',
          width: '宽',
          height: '高',
          save: '保存并应用',
          apply: '立即应用',
          saved: '已保存，下次启动生效',
          applied: '已应用',
          failed: '保存失败',
          loading: '读取中…',
        }
      : {
          title: 'Window size',
          description: 'Scales and centres the desktop window on launch (Windows only)',
          width: 'W',
          height: 'H',
          save: 'Save and apply',
          apply: 'Apply now',
          saved: 'Saved — used on the next launch',
          applied: 'Applied',
          failed: 'Save failed',
          loading: 'Loading…',
        }

    const toPercent = (ratio) => String(Math.round(Number(ratio) * 10000) / 100)

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '16px 0',
      borderBottom: '0.5px solid var(--dsw-alias-border-l2, #e5e7eb)',
    }
    const textStyle = { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }
    const titleStyle = {
      fontSize: '14px',
      lineHeight: '22px',
      color: 'var(--dsw-alias-label-primary, #0f1115)',
    }
    const descStyle = {
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    }
    const inputStyle = {
      width: '64px',
      height: '32px',
      padding: '0 8px',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      background: 'var(--dsw-alias-bg-module-platform, #f3f4f6)',
      color: 'var(--dsw-alias-label-primary, #0f1115)',
      fontSize: '13px',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
    }
    const unitStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #6b7280)' }
    const buttonStyle = {
      height: '32px',
      padding: '0 12px',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      border: 'none',
      background: 'var(--dsw-alias-bg-module-platform, #f3f4f6)',
      color: 'var(--dsw-alias-label-primary, #0f1115)',
      fontSize: '13px',
      fontFamily: 'inherit',
      cursor: 'pointer',
    }

    function Row() {
      const [width, setWidth] = React.useState('')
      const [height, setHeight] = React.useState('')
      const [status, setStatus] = React.useState(copy.loading)
      const [error, setError] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(() => {
        fetch(`${API}/state`, { cache: 'no-store' })
          .then((response) => response.json())
          .then((data) => {
            if (data?.ok !== true) throw new Error(data?.error || 'state failed')
            setWidth(toPercent(data.widthRatio))
            setHeight(toPercent(data.heightRatio))
            setStatus('')
            setError(false)
          })
          .catch((cause) => {
            setError(true)
            setStatus(String(cause?.message ?? cause))
          })
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const post = React.useCallback(async (suffix, body) => {
        const response = await fetch(`${API}/${suffix}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        return response.json()
      }, [])

      const save = React.useCallback(async () => {
        setBusy(true)
        try {
          const result = await post('save', {
            widthRatio: Number(width) / 100,
            heightRatio: Number(height) / 100,
          })
          if (result?.ok !== true) throw new Error(result?.error || copy.failed)
          setError(false)
          setStatus(copy.saved)
        } catch (cause) {
          setError(true)
          setStatus(`${copy.failed}: ${String(cause?.message ?? cause)}`)
          load()
        } finally {
          setBusy(false)
        }
      }, [post, width, height, load])

      const applyNow = React.useCallback(async () => {
        setBusy(true)
        try {
          const result = await post('apply')
          if (result?.ok !== true) throw new Error(result?.error || copy.failed)
          setError(false)
          setStatus(copy.applied)
        } catch (cause) {
          setError(true)
          setStatus(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }, [post])

      return h('div', { style: rowStyle }, [
        h('div', { key: 'text', style: textStyle }, [
          h('div', { key: 'title', style: titleStyle }, copy.title),
          h('div', { key: 'desc', style: descStyle }, status || copy.description),
        ]),
        h('div', { key: 'width', style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
          h('span', { key: 'label', style: unitStyle }, copy.width),
          h('input', {
            key: 'input',
            type: 'number',
            min: 10,
            max: 100,
            step: 0.5,
            value: width,
            disabled: busy,
            style: inputStyle,
            onChange: (event) => setWidth(event.target.value),
          }),
          h('span', { key: 'unit', style: unitStyle }, '%'),
        ]),
        h('div', { key: 'height', style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
          h('span', { key: 'label', style: unitStyle }, copy.height),
          h('input', {
            key: 'input',
            type: 'number',
            min: 10,
            max: 100,
            step: 0.5,
            value: height,
            disabled: busy,
            style: inputStyle,
            onChange: (event) => setHeight(event.target.value),
          }),
          h('span', { key: 'unit', style: unitStyle }, '%'),
        ]),
        h('button', {
          key: 'save',
          type: 'button',
          disabled: busy,
          style: buttonStyle,
          onClick: save,
        }, copy.save),
        h('button', {
          key: 'apply',
          type: 'button',
          disabled: busy,
          style: buttonStyle,
          onClick: applyNow,
        }, copy.apply),
        error ? h('span', { key: 'error', style: { display: 'none' } }, '') : null,
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            { name: 'settings.general.item', id: 'window-fit', order: 14 },
            Row,
          ),
        )
      },
    }
  },
})
